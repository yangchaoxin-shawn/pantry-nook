"""设计预览字体分包：本地源字体转换为按需加载的 WOFF2，保留 OFL。"""
from pathlib import Path
import json
import tempfile

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
SOURCE = Path(tempfile.gettempdir()) / 'pantry-xiaolai-v3.126.ttf'
TARGET = ROOT / 'assets/fonts'


def build():
    available = set(TTFont(SOURCE).getBestCmap())
    # 固定页面先加载；任意新菜名按字符范围加载其他包，覆盖源字体字符。
    ui = set(range(32, 127))
    for path in [ROOT/'index.html', *ROOT.glob('*.js')]:
        ui.update(map(ord, path.read_text(encoding='utf-8')))
    ui &= available
    remaining = sorted(available - ui)
    groups = [('ui', sorted(ui))] + [(f'part-{i//1024:02}', remaining[i:i+1024]) for i in range(0, len(remaining), 1024)]
    rules, manifest = [], []
    for name, points in groups:
        font = TTFont(SOURCE)
        options = subset.Options()
        options.flavor = 'woff2'
        options.name_IDs = ['*']
        cutter = subset.Subsetter(options=options)
        cutter.populate(unicodes=points)
        cutter.subset(font)
        for record in font['name'].names:
            if record.nameID in (1, 4, 6, 16):
                record.string = ('PantryHand' if record.nameID == 6 else 'Pantry Hand').encode(record.getEncoding())
        font.flavor = 'woff2'
        path = TARGET / f'hand-{name}.woff2'
        font.save(path)
        ranges = []
        start = end = points[0]
        for point in points[1:]:
            if point == end+1:
                end = point
            else:
                ranges.append(f'U+{start:X}' + (f'-{end:X}' if start != end else ''))
                start = end = point
        ranges.append(f'U+{start:X}' + (f'-{end:X}' if start != end else ''))
        rules.append(f"@font-face{{font-family:'Pantry Hand';font-style:normal;font-weight:400 700;font-display:swap;src:url('assets/fonts/{path.name}') format('woff2');unicode-range:{','.join(ranges)};}}")
        manifest.append({'file':path.name,'glyphCodepoints':len(points),'bytes':path.stat().st_size})
    (ROOT/'handwriting.css').write_text('/* 小赖字体 v3.126 的本地分包；许可见 assets/fonts/OFL-Xiaolai.txt。 */\n'+'\n'.join(rules)+'\n',encoding='utf-8')
    (TARGET/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'parts':len(groups),'characters':sum(len(g[1]) for g in groups),'first_load_bytes':manifest[0]['bytes'],'total_bytes':sum(item['bytes'] for item in manifest)}))


if __name__ == '__main__':
    build()
