"""有时限的独立媒体进程；原件只读，所有展示文件另存。"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import subprocess
import sys
import warnings

from PIL import Image, ImageCms, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = 60_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)


def run(args: list[str], timeout: int = 35) -> bytes:
    result = subprocess.run(args, capture_output=True, timeout=timeout,
                            env={**os.environ, 'LC_ALL': 'C', 'LANG': 'C'})
    if result.returncode:
        raise ValueError('媒体无法解码，文件可能已损坏')
    return result.stdout


def metadata(path: Path) -> dict:
    return json.loads(run([os.getenv('EXIFTOOL_PATH', 'exiftool'), '-j', '-G1', '-s',
                           '-FileType', '-ContentIdentifier', '-MotionPhoto', str(path)]))[0]


def make_motion(source: Path, directory: Path) -> tuple[int, int]:
    probe = json.loads(run([os.getenv('FFPROBE_PATH', 'ffprobe'), '-v', 'error', '-protocol_whitelist', 'file,pipe',
                           '-show_streams', '-show_format', '-of', 'json', str(source)]))
    videos = [item for item in probe.get('streams', []) if item.get('codec_type') == 'video']
    if not videos:
        raise ValueError('未找到可播放的动态片段')
    stream = videos[0]
    duration = float(probe.get('format', {}).get('duration', stream.get('duration', 0)))
    width, height = int(stream.get('width', 0)), int(stream.get('height', 0))
    if not 0 < duration <= 15 or not 0 < max(width, height) <= 4096:
        raise ValueError('实况片段最多 15 秒，长边不得超过 4096 像素')
    run([os.getenv('FFMPEG_PATH', 'ffmpeg'), '-nostdin', '-v', 'error', '-y',
         '-protocol_whitelist', 'file,pipe', '-i', str(source), '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1',
         '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:out_range=tv', '-threads', '2',
         '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
         '-color_range', 'tv', '-c:a', 'aac', '-movflags', '+faststart',
         str(directory / 'motion.mp4')], timeout=55)
    return width, height


def process(directory: Path) -> dict:
    source = directory / 'original'
    meta = metadata(source)
    file_type = meta.get('File:FileType', '')
    pair = meta.get('Apple:ContentIdentifier') or meta.get('Keys:ContentIdentifier')
    if pair is not None:
        pair = str(pair).strip()
        if not pair or len(pair) > 200:
            raise ValueError('实况配对标识无效')
    if file_type in ('MOV', 'MP4'):
        if not pair:
            raise ValueError('仅支持与照片配对的 Apple 实况视频，请同时选择原片与 MOV')
        width, height = make_motion(source, directory)
        return dict(kind='video', live_kind='apple_video', pair_identifier=pair,
                    width=width, height=height, preview_width=width, preview_height=height,
                    mime='video/quicktime' if file_type == 'MOV' else 'video/mp4', motion=True)
    with Image.open(source) as original:
        if original.format not in ('JPEG', 'PNG', 'WEBP', 'HEIF'):
            raise ValueError('支持 JPEG、PNG、WebP 和 HEIC 图片')
        if original.width * original.height > 60_000_000:
            raise ValueError('图片不能超过 6000 万像素')
        mime = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp', 'HEIF': 'image/heic'}[original.format]
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
    has_motion = False
    for tag in ('MotionPhotoVideo', 'EmbeddedVideoFile'):
        if meta.get('XMP-GCamera:MotionPhoto') == 0:
            break
        video = run([os.getenv('EXIFTOOL_PATH', 'exiftool'), '-b', '-' + tag, str(source)])
        if video:
            if len(video) > 50 * 1024 * 1024 or video not in source.read_bytes():
                raise ValueError('动态片段与原片不一致')
            extracted = directory / 'embedded.mp4'
            extracted.write_bytes(video)
            make_motion(extracted, directory)
            extracted.unlink()
            has_motion = True
            break
    return dict(kind='image', live_kind='motion_photo' if has_motion else ('apple_photo' if pair else 'still'),
                pair_identifier=pair, width=width, height=height, preview_width=pw,
                preview_height=ph, mime=mime, motion=has_motion)


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
