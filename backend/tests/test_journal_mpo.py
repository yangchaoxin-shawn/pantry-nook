"""静图真实解码与原件保留；MPO 只取主图，不提取实况。"""
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from PIL import Image, UnidentifiedImageError

from app.journal_worker import process


def write_mpo(path: Path) -> bytes:
    """生成可解码 MPF JPEG，而非伪造 Image.format 的 mock。"""
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = 'private test metadata'
    Image.new('RGB', (120, 80), 'red').save(
        path, format='MPO', save_all=True,
        append_images=[Image.new('RGB', (60, 40), 'blue')], exif=exif,
    )
    return path.read_bytes()


class JournalMpoTests(unittest.TestCase):
    def test_mpf_jpeg_primary_orientation_and_original_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            before = write_mpo(folder / 'original')
            self.assertTrue(before.startswith(b'\xff\xd8\xff'))
            with Image.open(folder / 'original') as original:
                self.assertEqual(original.format, 'MPO')
                self.assertEqual(original.n_frames, 2)
            result = process(folder)
            self.assertEqual(result['mime'], 'image/jpeg')
            self.assertEqual((result['width'], result['height']), (80, 120))
            self.assertEqual((folder / 'original').read_bytes(), before)
            self.assertEqual({p.name for p in folder.iterdir()}, {'original', 'preview.jpg', 'thumbnail.jpg'})
            for filename in ('preview.jpg', 'thumbnail.jpg'):
                with Image.open(folder / filename) as preview:
                    self.assertEqual(preview.format, 'JPEG')
                    self.assertEqual(preview.size, (80, 120))
                    self.assertFalse(preview.getexif())
                    red, green, blue = preview.getpixel((40, 60))
                    self.assertGreater(red, 240)
                    self.assertLess(max(green, blue), 15)

    def test_supported_formats_decode_without_modifying_original(self):
        for file_format, mime in [('JPEG', 'image/jpeg'), ('PNG', 'image/png'),
                                  ('WEBP', 'image/webp'), ('HEIF', 'image/heic')]:
            with self.subTest(format=file_format), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)
                Image.new('RGB', (80, 60), 'green').save(folder / 'original', format=file_format)
                before = (folder / 'original').read_bytes()
                result = process(folder)
                self.assertEqual(result['mime'], mime)
                self.assertEqual(result['kind'], 'image')
                self.assertFalse({'motion', 'live_kind', 'pair_identifier'} & result.keys())
                self.assertEqual((folder / 'original').read_bytes(), before)
                with Image.open(folder / 'preview.jpg') as image:
                    self.assertEqual(image.size, (80, 60))

    def test_other_decodable_formats_rejected_with_format_hint(self):
        for file_format in ('GIF', 'TIFF', 'BMP'):
            with self.subTest(format=file_format), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)
                Image.new('RGB', (8, 8)).save(folder / 'original', format=file_format)
                with self.assertRaises(ValueError) as caught:
                    process(folder)
                self.assertIn(file_format, str(caught.exception))
                self.assertNotIn(temp, str(caught.exception))
                self.assertFalse((folder / 'preview.jpg').exists())

    def test_invalid_jpeg_and_disguised_video_rejected(self):
        for raw in (b'\xff\xd8\xffinvalid', b'\x00\x00\x00\x18ftypqt  invalid video',
                    b'\x00\x00\x00\x18ftypmp42invalid video'):
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)
                (folder / 'original').write_bytes(raw)
                with self.assertRaises(UnidentifiedImageError):
                    process(folder)
                self.assertFalse((folder / 'preview.jpg').exists())

    def test_public_live_samples_are_static_and_mov_rejected(self):
        samples = os.getenv('JOURNAL_REAL_MEDIA_SAMPLES')
        if not samples:
            self.skipTest('设置 JOURNAL_REAL_MEDIA_SAMPLES 以测试已下载的公开实况原件')
        for filename in ('apple-iphone15.heic', 'pixel-8a.jpg', 'samsung-one-ui-6.heic', 'apple-iphone15.mov'):
            with self.subTest(sample=filename), tempfile.TemporaryDirectory() as temp:
                source = Path(samples) / filename
                self.assertTrue(source.is_file(), f'缺少测试素材 {filename}')
                folder = Path(temp)
                shutil.copyfile(source, folder / 'original')
                before = hashlib.sha256(source.read_bytes()).hexdigest()
                if filename.endswith('.mov'):
                    with self.assertRaises(UnidentifiedImageError):
                        process(folder)
                else:
                    result = process(folder)
                    self.assertEqual(result['kind'], 'image')
                    self.assertFalse({'motion', 'live_kind', 'pair_identifier'} & result.keys())
                    self.assertTrue((folder / 'preview.jpg').exists())
                self.assertEqual(hashlib.sha256((folder / 'original').read_bytes()).hexdigest(), before)
                self.assertFalse((folder / 'motion.mp4').exists())


if __name__ == '__main__':
    unittest.main()
