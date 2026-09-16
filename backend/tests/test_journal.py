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
    def test_pair_metadata_not_filename_and_missing_video(self):
        image = sample(live='apple_photo', pair='a')
        video = sample('video', 'apple_video', 'a', True)
        self.assertEqual(photos([image, video])[0]['live_status'], 'live')
        self.assertEqual(photos([image])[0]['live_status'], 'missing_video')
        with self.assertRaises(AppError):
            photos([image, sample('video', 'apple_video', 'b', True)])
        with self.assertRaises(AppError):
            photos([video])

    def test_nine_photo_cap_and_duplicates(self):
        self.assertEqual(len(photos([sample() for _ in range(9)])), 9)
        with self.assertRaises(AppError):
            photos([sample() for _ in range(10)])
        with self.assertRaises(AppError):
            photos([sample(pair='a'), sample(pair='a')])

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
            with patch('app.journal_worker.metadata', return_value={'File:FileType': 'JPEG'}), patch('app.journal_worker.run', return_value=b''):
                result = process(folder)
            self.assertEqual((result['width'], result['height']), (80, 120))
            self.assertEqual((folder / 'original').read_bytes(), before)
            with Image.open(folder / 'preview.jpg') as image:
                self.assertEqual(image.size, (80, 120))
                self.assertFalse(image.getexif())

    def test_stale_motion_flag_does_not_create_live(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            Image.new('RGB', (8, 8)).save(folder / 'original', format='JPEG')
            with patch('app.journal_worker.metadata', return_value={'File:FileType': 'JPEG', 'XMP-GCamera:MotionPhoto': 1}), patch('app.journal_worker.run', return_value=b''):
                self.assertEqual(process(folder)['live_kind'], 'still')
            with patch('app.journal_worker.metadata', return_value={'File:FileType': 'JPEG', 'XMP-GCamera:MotionPhoto': 0}), patch('app.journal_worker.run') as tools:
                self.assertEqual(process(folder)['live_kind'], 'still')
                tools.assert_not_called()

    def test_openapi_uuid_and_multipart(self):
        schema = app.openapi()
        upload = schema['paths']['/api/journal/uploads']['post']
        self.assertIn('multipart/form-data', upload['requestBody']['content'])
        media = schema['paths']['/api/journal/media/{upload_id}/{variant}']
        self.assertNotEqual(media['get']['operationId'], media['head']['operationId'])
        uuid = next(p for p in media['get']['parameters'] if p['name'] == 'upload_id')
        self.assertEqual(uuid['schema']['format'], 'uuid')


if __name__ == '__main__':
    unittest.main()
