"""有时限的独立媒体进程；原件只读，所有展示文件另存。"""
from __future__ import annotations

from datetime import date, timedelta
import io
import json
from pathlib import Path
import sys
import warnings

from PIL import Image, ImageCms, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = 60_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)


def taken_on(image: Image.Image) -> str | None:
    # 只取拍摄日期，用于自动归档到哪一天；坐标、设备等其余元数据不读取。
    try:
        exif = image.getexif()
        # 只认原始拍摄时间；306 是文件修改时间，导出或编辑过的图会是导出那天。
        raw = exif.get_ifd(0x8769).get(36867)
    except Exception:
        return None
    if not isinstance(raw, str):
        return None
    try:
        parsed = date(int(raw[0:4]), int(raw[5:7]), int(raw[8:10]))
    except ValueError:
        return None
    # 相机时钟不准时会写出离谱日期；明显晚于今天（留一天时区余量）的不采用。
    return parsed.isoformat() if date(2000, 1, 1) <= parsed <= date.today() + timedelta(days=1) else None


def process(directory: Path) -> dict:
    source = directory / 'original'
    with Image.open(source) as original:
        if original.format not in ('JPEG', 'MPO', 'PNG', 'WEBP', 'HEIF'):
            raise ValueError(f'暂不支持 {original.format or "未知"} 图片，请选择 JPEG、PNG、WebP 或 HEIC 原片')
        # 部分 JPEG 带有 MPF 副图（例如增益图），Pillow 将其识别为 MPO。
        # 只解码静态主图；副图及可能内嵌的视频字节仍保留在原件中。
        if original.format == 'MPO':
            original.seek(0)
        if original.width * original.height > 60_000_000:
            raise ValueError('图片不能超过 6000 万像素')
        mime = {'JPEG': 'image/jpeg', 'MPO': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp', 'HEIF': 'image/heic'}[original.format]
        shot = taken_on(original)
        display = ImageOps.exif_transpose(original)
        width, height = display.size
        profile = display.info.get('icc_profile')
        if profile:
            try:
                display = ImageCms.profileToProfile(display, ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                                                    ImageCms.createProfile('sRGB'), outputMode='RGB')
            except (ValueError, OSError, ImageCms.PyCMSError):
                display = display.convert('RGB')
        else:
            display = display.convert('RGB')
        # 重建像素画布，不把定位、设备等 EXIF 放入展示副本。
        clean = Image.new('RGB', display.size)
        clean.paste(display)
        clean.thumbnail((2560, 2560))
        pw, ph = clean.size
        clean.save(directory / 'preview.jpg', quality=92)
        clean.thumbnail((640, 640))
        clean.save(directory / 'thumbnail.jpg', quality=85)
    return dict(kind='image', width=width, height=height, preview_width=pw,
                preview_height=ph, mime=mime, taken_on=shot)



if __name__ == '__main__':
    try:
        result = process(Path(sys.argv[1]))
        print(json.dumps({'data': result}, ensure_ascii=True))
    except FileNotFoundError:
        print(json.dumps({'error': '媒体处理组件暂不可用，请稍后重试'}))
        raise SystemExit(2)
    except Exception as exc:
        message = str(exc) if isinstance(exc, ValueError) else '文件无法处理或处理超时，请检查原片后重试'
        print(json.dumps({'error': message}, ensure_ascii=True))
        raise SystemExit(1)
