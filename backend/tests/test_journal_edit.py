"""照片编辑的输入、封面和兼容幂等规则；真实事务由隔离 API 验证。"""
import hashlib
import json
import unittest
from uuid import uuid4

from pydantic import ValidationError

from app.errors import AppError
from app.journal_models import EntryCreate, EntryUpdate
from app.routes.journal import check_cover, request_hash, validate_filename
from test_journal import sample


class JournalEditTests(unittest.TestCase):
    def test_old_create_hash_remains_compatible(self):
        original = dict(entry_date='2039-01-01', caption='旧请求', upload_ids=[str(uuid4())])
        before = hashlib.sha256(json.dumps(original, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        body = EntryCreate(**original, client_request_id=uuid4())
        self.assertEqual(request_hash(body), before)
        self.assertEqual(request_hash(body.model_copy(update={'cover_upload_id': None})), before)
        self.assertNotEqual(request_hash(body.model_copy(update={'cover_upload_id': body.upload_ids[0]})), before)

    def test_photo_edit_requires_full_intent_but_text_edit_compatible(self):
        basic = dict(entry_date='2039-01-01', expected_updated_at='2039-01-01T00:00:00Z')
        EntryUpdate(**basic)
        image = uuid4()
        with self.assertRaises(ValidationError):
            EntryUpdate(**basic, cover_upload_id=image)
        with self.assertRaises(ValidationError):
            EntryUpdate(**basic, upload_ids=[image], cover_upload_id=image)
        EntryUpdate(**basic, upload_ids=[image], cover_upload_id=image, client_request_id=uuid4())
        with self.assertRaises(ValidationError):
            EntryUpdate(**basic, upload_ids=[], cover_upload_id=image, client_request_id=uuid4())

    def test_cover_is_image_and_does_not_reorder_photos(self):
        first, second = sample(), sample(live='apple_photo', pair='one')
        video = sample('video', 'apple_video', 'one', True)
        rows = [video, first, second]
        self.assertEqual(check_cover(rows, None), first['id'])
        self.assertEqual(check_cover(rows, second['id']), second['id'])
        self.assertEqual(rows[0], video)
        for invalid in (video['id'], uuid4()):
            with self.assertRaises(AppError):
                check_cover(rows, invalid)

    def test_extension_and_decoded_content_must_agree(self):
        for name, mime in [('A.JPG', 'image/jpeg'), ('a.jpeg', 'image/jpeg'),
                           ('a.png', 'image/png'), ('a.webp', 'image/webp'),
                           ('a.heic', 'image/heic'), ('a.heif', 'image/heic'),
                           ('a.MOV', 'video/quicktime')]:
            validate_filename(name, mime)
        for name in ('report.pdf', 'photo.jpg.exe', 'document.docx', 'zip.zip', 'clip.mp4', 'no-extension'):
            with self.assertRaises(AppError):
                validate_filename(name)
        for name, mime in [('fake.jpg', 'application/pdf'), ('fake.png', 'image/jpeg'), ('fake.mov', 'video/mp4')]:
            with self.assertRaises(AppError):
                validate_filename(name, mime)


if __name__ == '__main__':
    unittest.main()
