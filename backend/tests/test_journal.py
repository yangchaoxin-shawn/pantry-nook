"""无需数据库的媒体边界；真正上传事务另由隔离 API 集成测试验证。"""
import asyncio
from datetime import date
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from app.errors import AppError
from app.journal_media import JournalBodyLimit, MAX_REQUEST_BYTES
from app.journal_worker import process
from app.main import app
from app.routes.journal import photos


def sample(kind='image', live='still', pair=None, motion=False):
    return dict(id=uuid4(), sha256='a' * 64, original_name='test.jpg', original_size=10,
                details=dict(kind=kind, live_kind=live, pair_identifier=pair, width=100,
                             height=100, preview_width=100, preview_height=100, motion=motion))


class JournalTests(unittest.TestCase):
    def test_old_live_metadata_is_ignored_and_video_hidden(self):
        image = sample(live='apple_photo', pair='a')
        video = sample('video', 'apple_video', 'a', True)
        result = photos([image, video])
        self.assertEqual(result, photos([image]))
        self.assertEqual(set(result[0]), {'id', 'image'})
        self.assertFalse({'live_kind', 'pair_identifier', 'video_url'} & result[0]['image'].keys())
        self.assertEqual(photos([image, sample('video', 'apple_video', 'b', True)]), result)
        with self.assertRaises(AppError):
            photos([video])
        unknown = sample()
        unknown['details'].pop('kind')
        self.assertEqual(photos([image, unknown]), result)

    def test_nine_photo_cap_and_pair_metadata_does_not_group(self):
        self.assertEqual(len(photos([sample() for _ in range(9)])), 9)
        with self.assertRaises(AppError):
            photos([sample() for _ in range(10)])
        self.assertEqual(len(photos([sample(pair='a'), sample(pair='a')])), 2)

    def test_content_length_blocked_before_multipart(self):
        response = TestClient(app).post('/api/journal/uploads', content=b'bad',
                                       headers={'Content-Length': str(MAX_REQUEST_BYTES + 1)})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['error']['code'], 'UPLOAD_TOO_LARGE')

    def test_chunked_body_limited(self):
        async def scenario():
            sent = []
            async def inner(scope, receive, send):
                try:
                    while (await receive()).get('more_body', False):
                        pass
                except Exception:
                    await send({'type': 'http.response.start', 'status': 400, 'headers': []})
                    await send({'type': 'http.response.body', 'body': b'error'})
            async def receive():
                return {'type': 'http.request', 'body': b'1' * 1024 * 1024, 'more_body': True}
            async def send(message):
                sent.append(message)
            await JournalBodyLimit(inner)({'type': 'http', 'path': '/api/journal/uploads', 'method': 'POST', 'headers': []}, receive, send)
            self.assertEqual(sent[0]['status'], 413)
            self.assertEqual(json.loads(sent[1]['body'])['error']['code'], 'UPLOAD_TOO_LARGE')
        asyncio.run(scenario())

    def test_preview_orientation_and_metadata_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            exif = Image.Exif()
            exif[274] = 6
            exif[270] = 'private metadata'
            Image.new('RGB', (120, 80)).save(folder / 'original', format='JPEG', exif=exif)
            before = (folder / 'original').read_bytes()
            result = process(folder)
            self.assertEqual((result['width'], result['height']), (80, 120))
            self.assertEqual((folder / 'original').read_bytes(), before)
            with Image.open(folder / 'preview.jpg') as image:
                self.assertEqual(image.size, (80, 120))
                self.assertFalse(image.getexif())

    def test_taken_on_read_from_exif_and_absent_when_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            exif = Image.Exif()
            exif.get_ifd(0x8769)[36867] = '2026:10:11 19:42:05'
            Image.new('RGB', (20, 20)).save(folder / 'original', format='JPEG', exif=exif)
            self.assertEqual(process(folder)['taken_on'], '2026-10-11')
        for raw, tag in ((None, None), ('0000:00:00 00:00:00', 36867), ('garbage', 36867), ('2026:10:11 08:00:00', 306), ('2099:01:01 08:00:00', 36867)):
            with tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)
                exif = Image.Exif()
                if tag == 306:
                    exif[306] = raw  # 只有文件修改时间，不当作拍摄日
                elif raw:
                    exif.get_ifd(0x8769)[tag] = raw
                Image.new('RGB', (20, 20)).save(folder / 'original', format='PNG' if raw is None else 'JPEG', **({} if raw is None else {'exif': exif}))
                self.assertIsNone(process(folder)['taken_on'], raw)

    def test_trailing_video_bytes_preserved_without_external_tools(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            Image.new('RGB', (8, 8)).save(folder / 'original', format='JPEG')
            with (folder / 'original').open('ab') as original:
                original.write(b'\x00\x00\x00\x18ftypmp42embedded video fixture')
            before = (folder / 'original').read_bytes()
            with patch('subprocess.run', side_effect=AssertionError('不能提取或转码视频')):
                result = process(folder)
            self.assertEqual((folder / 'original').read_bytes(), before)
            self.assertFalse({'motion', 'pair_identifier', 'live_kind'} & result.keys())
            self.assertEqual({p.name for p in folder.iterdir()}, {'original', 'preview.jpg', 'thumbnail.jpg'})

    def test_openapi_uuid_and_multipart(self):
        schema = app.openapi()
        upload = schema['paths']['/api/journal/uploads']['post']
        self.assertIn('multipart/form-data', upload['requestBody']['content'])
        media = schema['paths']['/api/journal/media/{upload_id}/{variant}']
        self.assertNotEqual(media['get']['operationId'], media['head']['operationId'])
        uuid = next(p for p in media['get']['parameters'] if p['name'] == 'upload_id')
        self.assertEqual(uuid['schema']['format'], 'uuid')
        variant = next(p for p in media['get']['parameters'] if p['name'] == 'variant')
        self.assertEqual(variant['schema']['enum'], ['original', 'preview', 'thumbnail'])


if __name__ == '__main__':
    unittest.main()
