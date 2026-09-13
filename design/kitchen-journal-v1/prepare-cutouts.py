"""用户已授权的本地插画去底；仅处理独立设计素材，不改原图。"""
from pathlib import Path
import argparse
import json
import os
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
SOURCES = {
    'kitchen-team': ROOT / 'heytea-direction/direction.png',
    'pantry-home': ROOT / 'assets/pantry-collage.png',
    'recipe-time': ROOT / 'assets/recipe-collage.png',
    **{p.stem: p for p in sorted((ROOT / 'assets/illustration-drafts').glob('*.png'))},
}
# 经目视定位的封闭背景孔洞；不能将白色人物、碗盘当作背景整块删除。
HOLES = {}
PROTECTED_POLYGONS = {
    'recipe-afternoon': [
        [(227,304),(575,308),(687,327),(742,356),(785,778),(734,773),(689,754),(574,735),(392,733),(158,743)],
        [(745,359),(783,330),(925,272),(1184,189),(1334,505),(1308,555),(1265,616),(1181,670),(1085,704),(889,741),(792,777)],
    ],
    'recipe-time': [[(365,366),(510,339),(619,329),(635,392),(678,550),(650,615),(652,688),(439,728)]],
    'tomato-egg': [[(807,225),(631,245),(455,296),(337,360),(270,430),(246,500),(272,613),(354,715),(513,795),(714,840),(913,851),(1108,820),(1271,755),(1390,668),(1447,565),(1446,498),(1396,436),(1298,337),(1140,274),(985,236)]],
}
LINE_FILL_REGIONS = {
    'three-bowls': [(75,460,213,700)],
    'pantry-jars': [(1230,515,1480,820)],
    'recipe-afternoon': [(85,295,1430,824)],
    'chicken-greens': [(248,305,1355,928)],
}
SESSION = None


def semantic_mask(image):
    global SESSION
    import onnxruntime as ort
    if SESSION is None:
        model = Path(os.environ.get('PANTRY_CUTOUT_MODEL', str(Path(tempfile.gettempdir()) / 'pantry-nook-u2net.onnx')))
        SESSION = ort.InferenceSession(str(model), providers=['CPUExecutionProvider'])
    pixels = np.array(image.resize((320,320), Image.Resampling.LANCZOS)).astype('float32') / 255
    pixels = (pixels - np.array([.485,.456,.406],dtype='float32')) / np.array([.229,.224,.225],dtype='float32')
    prediction = SESSION.run(None, {SESSION.get_inputs()[0].name: pixels.transpose(2,0,1)[None]})[0][0,0]
    prediction = (prediction-prediction.min()) / max(float(prediction.max()-prediction.min()), .001)
    return np.array(Image.fromarray((prediction*255).astype('uint8')).resize(image.size, Image.Resampling.LANCZOS)).astype('float32') / 255


def exterior(rgb, threshold, seeds=()):
    delta = 255 - rgb.min(axis=2)
    allowed = (delta < threshold).astype('uint8') * 255
    mask = Image.fromarray(allowed).copy()
    width, height = mask.size
    starts = [(0, 0), (width-1, 0), (0, height-1), (width-1, height-1), *seeds]
    for start in starts:
        if mask.getpixel(start) == 255:
            ImageDraw.floodfill(mask, start, 128)
    return np.array(mask) == 128


def prepare(key):
    source = Image.open(SOURCES[key]).convert('RGB')
    rgb = np.array(source).astype('float32')
    # 估计画布色，统一到白色分析空间；保留原物件内部颜色。
    border = np.concatenate((rgb[:25].reshape(-1, 3), rgb[-25:].reshape(-1, 3)))
    base = np.percentile(border, 60, axis=0)
    normalized = np.clip(rgb + (255-base), 0, 255)
    seeds = HOLES.get(key, [])
    outside = exterior(normalized, 120, seeds)
    clean = exterior(normalized, 11, seeds)
    semantic = semantic_mask(source)
    opaque = ~outside | (semantic > .9)
    # 人工核查后补回被模型误判的浅色书页和盘沿，均在物件轮廓内。
    protected = Image.new('L', source.size)
    pen = ImageDraw.Draw(protected)
    for polygon in PROTECTED_POLYGONS.get(key, []):
        pen.polygon(polygon, fill=255)
    opaque |= np.array(protected) > 0
    if key in LINE_FILL_REGIONS:
        line_fill = ~exterior(normalized, 32)
        for x0,y0,x1,y1 in LINE_FILL_REGIONS[key]:
            opaque[y0:y1,x0:x1] |= line_fill[y0:y1,x0:x1]
    # 封闭的轮廓内部保留不透明；外围仅保留接触阴影和抗锯齿。
    alpha = opaque.astype('float32')
    transition = outside & ~clean & ~opaque
    distance = (255-normalized.min(axis=2)) / 255
    alpha[transition] = np.minimum(distance[transition] * 1.5, .35)
    mask = Image.fromarray((alpha*255).astype('uint8')).filter(ImageFilter.GaussianBlur(.45))
    a = np.array(mask).astype('float32') / 255
    a[a < .015] = 0
    a[a > .99] = 1
    # 解开白底混色，避免深色页面出现白边；仅修整轮廓过渡像素。
    recovered = np.clip((rgb - (1-a[..., None])*base) / np.maximum(a[..., None], .01), 0, 255)
    recovered[a == 1] = rgb[a == 1]
    recovered[a == 0] = 0
    output = Image.fromarray(np.dstack((recovered, a*255)).astype('uint8'), 'RGBA')
    # 裁去空画布后补统一安全留白；完整保留原构图所有有形内容。
    bbox = Image.fromarray((a > .08).astype('uint8')*255).getbbox()
    x0,y0,x1,y1 = bbox
    pad = 36
    output = output.crop((max(0,x0-pad), max(0,y0-pad), min(source.width,x1+pad), min(source.height,y1+pad)))
    output.thumbnail((1440, 1000), Image.Resampling.LANCZOS)
    clear_border(output)
    folder = ROOT / 'assets/cutouts'
    folder.mkdir(parents=True, exist_ok=True)
    output.save(folder / f'{key}.png', optimize=True)
    web = output.copy()
    web.thumbnail((960, 720), Image.Resampling.LANCZOS)
    clear_border(web)
    web.save(folder / f'{key}.webp', quality=88, method=6, exact=True)
    return key


def clear_border(image):
    alpha = image.getchannel('A')
    ImageDraw.Draw(alpha).rectangle((0,0,image.width-1,image.height-1), outline=0, width=2)
    image.putalpha(alpha)


def verify():
    records = []
    for key in SOURCES:
        for suffix in ('png', 'webp'):
            path = ROOT / f'assets/cutouts/{key}.{suffix}'
            image = Image.open(path)
            assert image.mode == 'RGBA', f'{path.name}: 缺少 RGBA'
            alpha = np.array(image.getchannel('A'))
            transparent = float((alpha == 0).mean())
            assert .1 < transparent < .95, f'{path.name}: 透明范围异常'
            assert alpha.max() == 255, f'{path.name}: 缺少不透明主体'
            assert all(alpha[y,x] == 0 for y,x in [(0,0),(0,-1),(-1,0),(-1,-1)]), f'{path.name}: 四角未透明'
            assert max(alpha[0].max(),alpha[-1].max(),alpha[:,0].max(),alpha[:,-1].max()) == 0, f'{path.name}: 画布边缘不透明'
            records.append({'file':str(path.relative_to(ROOT)).replace('\\','/'), 'mode':image.mode, 'size':list(image.size), 'transparentPercent':round(100*transparent,2), 'opaquePercent':round(100*float((alpha==255).mean()),2), 'bytes':path.stat().st_size})
    (ROOT / 'assets/cutouts/alpha-audit.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'{len(records)} 文件通过透明度检查')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('names', nargs='*')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.verify:
        verify()
    else:
        for key in args.names or SOURCES:
            print(prepare(key), flush=True)
