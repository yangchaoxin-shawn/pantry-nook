"""MPF/JPEG 主图兼容；真实解码，原件不改写，副图不冒充实况。"""
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, UnidentifiedImageError

from app.journal_worker import metadata, process


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
            with patch('app.journal_worker.metadata', return_value={'File:FileType': 'JPEG'}), \
                    patch('app.journal_worker.run', return_value=b''):
                result = process(folder)
            self.assertEqual(result['mime'], 'image/jpeg')
            self.assertEqual(result['live_kind'], 'still')
            self.assertFalse(result['motion'])
            self.assertEqual((result['width'], result['height']), (80, 120))
            self.assertEqual((folder / 'original').read_bytes(), before)
            self.assertFalse((folder / 'motion.mp4').exists())
            for filename in ('preview.jpg', 'thumbnail.jpg'):
                with Image.open(folder / filename) as preview:
                    self.assertEqual(preview.format, 'JPEG')
                    self.assertEqual(preview.size, (80, 120))
                    self.assertFalse(preview.getexif())
                    red, green, blue = preview.getpixel((40, 60))
                    self.assertGreater(red, 240)
                    self.assertLess(max(green, blue), 15)

    def test_mpo_apple_identifier_is_preserved_without_inventing_video(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            write_mpo(folder / 'original')
            with patch('app.journal_worker.metadata', return_value={
                'File:FileType': 'JPEG', 'Apple:ContentIdentifier': 'test-apple-pair',
            }), patch('app.journal_worker.run', return_value=b''):
                result = process(folder)
            self.assertEqual(result['live_kind'], 'apple_photo')
            self.assertEqual(result['pair_identifier'], 'test-apple-pair')
            self.assertFalse(result['motion'])

    def test_normal_jpeg_stays_still(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            Image.new('RGB', (80, 60), 'green').save(folder / 'original', format='JPEG')
            before = (folder / 'original').read_bytes()
            with patch('app.journal_worker.metadata', return_value={'File:FileType': 'JPEG'}), \
                    patch('app.journal_worker.run', return_value=b''):
                result = process(folder)
            self.assertEqual(result['mime'], 'image/jpeg')
            self.assertEqual(result['live_kind'], 'still')
            self.assertEqual((folder / 'original').read_bytes(), before)

    def test_other_decodable_formats_remain_rejected_with_format_hint(self):
        for file_format in ('GIF', 'TIFF', 'BMP'):
            with self.subTest(format=file_format), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)
                Image.new('RGB', (8, 8)).save(folder / 'original', format=file_format)
                with patch('app.journal_worker.metadata', return_value={'File:FileType': file_format}):
                    with self.assertRaises(ValueError) as caught:
                        process(folder)
                self.assertIn(file_format, str(caught.exception))
                self.assertNotIn(temp, str(caught.exception))
                self.assertFalse((folder / 'preview.jpg').exists())

    def test_invalid_jpeg_signature_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            (folder / 'original').write_bytes(b'\xff\xd8\xffinvalid')
            with patch('app.journal_worker.metadata', return_value={'File:FileType': 'JPEG'}):
                with self.assertRaises(UnidentifiedImageError):
                    process(folder)


class JournalMpoRealToolsTests(unittest.TestCase):
    def setUp(self):
        if not shutil.which(os.getenv('EXIFTOOL_PATH', 'exiftool')):
            self.skipTest('真实媒体测试需要 ExifTool')

    def test_generated_mpf_jpeg_with_real_exiftool(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            before = write_mpo(folder / 'original')
            self.assertEqual(metadata(folder / 'original')['File:FileType'], 'JPEG')
            result = process(folder)
            self.assertEqual(result['mime'], 'image/jpeg')
            self.assertEqual(result['live_kind'], 'still')
            self.assertFalse(result['motion'])
            self.assertEqual((folder / 'original').read_bytes(), before)

    def test_public_live_samples_with_real_tools(self):
        samples = os.getenv('JOURNAL_REAL_MEDIA_SAMPLES')
        if not samples:
            self.skipTest('设置 JOURNAL_REAL_MEDIA_SAMPLES 以测试已下载的公开实况原件')
        results = {}
        for filename, expected_kind in (
            ('apple-iphone15.heic', 'apple_photo'),
            ('apple-iphone15.mov', 'apple_video'),
            ('pixel-8a.jpg', 'motion_photo'),
            ('samsung-one-ui-6.heic', 'motion_photo'),
        ):
            with self.subTest(sample=filename), tempfile.TemporaryDirectory() as temp:
                source = Path(samples) / filename
                self.assertTrue(source.is_file(), f'缺少测试素材 {filename}')
                folder = Path(temp)
                shutil.copyfile(source, folder / 'original')
                before = hashlib.sha256(source.read_bytes()).hexdigest()
                result = process(folder)
                self.assertEqual(result['live_kind'], expected_kind)
                self.assertEqual(hashlib.sha256((folder / 'original').read_bytes()).hexdigest(), before)
                self.assertEqual(result['motion'], expected_kind != 'apple_photo')
                if result['motion']:
                    self.assertGreater((folder / 'motion.mp4').stat().st_size, 0)
                else:
                    self.assertTrue((folder / 'preview.jpg').exists())
                results[filename] = result
        self.assertTrue(results['apple-iphone15.heic']['pair_identifier'])
        self.assertEqual(results['apple-iphone15.heic']['pair_identifier'],
                         results['apple-iphone15.mov']['pair_identifier'])


if __name__ == '__main__':
    unittest.main()
