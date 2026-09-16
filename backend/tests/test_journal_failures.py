"""验证解码、文件就绪与数据库提交之间的失败窗口。"""
from contextlib import asynccontextmanager
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import Response, UploadFile

from app.errors import AppError
from app.routes import journal
from scripts.cleanup_journal_media import cleanup_one

DETAILS = dict(kind='image', live_kind='still', pair_identifier=None, width=10, height=10,
               preview_width=10, preview_height=10, mime='image/jpeg', motion=False)


class FakeDatabase:
    """仅仿真当前用例的事务状态；真实并发和 SQL 由隔离库集成覆盖。"""
    def __init__(self):
        self.row = None
        self.fail_commit = False

    @asynccontextmanager
    async def acquire(self):
        yield self

    @asynccontextmanager
    async def transaction(self, **kwargs):
        snapshot = dict(self.row) if self.row else None
        try:
            yield
        except BaseException:
            self.row = snapshot
            raise

    async def fetchval(self, sql, *args):
        return True

    async def execute(self, sql, *args):
        if sql.startswith('INSERT INTO journal_uploads') and self.row is None:
            self.row = dict(id=args[0], sha256=args[1], original_name=args[2], original_size=args[3],
                            status='failed', stale=False, entry_id=None, storage_path=None)
        elif "SET status='processing'" in sql:
            self.row['status'] = 'processing'
        elif "SET status='failed'" in sql and self.row['status'] == 'processing':
            self.row['status'] = 'failed'
        elif "SET status='cancelled'" in sql:
            self.row['status'] = 'cancelled'

    async def fetchrow(self, sql, *args):
        if sql.startswith('UPDATE journal_uploads SET status=\'ready\''):
            if self.fail_commit:
                self.fail_commit = False
                raise RuntimeError('模拟文件就绪后的数据库失败')
            self.row.update(status='ready', details=args[1], storage_path=args[2])
        elif "u.status='ready'" in sql and self.row['status'] != 'ready':
            return None
        return dict(self.row)


class FailureWindowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.env = patch.dict(os.environ, {'MEDIA_ROOT': str(self.root), 'MEDIA_MIN_FREE_BYTES': '0'})
        self.env.start()
        self.db = FakeDatabase()
        self.pool = patch.object(journal, 'get_pool', AsyncMock(return_value=self.db))
        self.pool.start()
        self.upload_id = uuid4()

    async def asyncTearDown(self):
        self.pool.stop()
        self.env.stop()
        self.temp.cleanup()

    async def send(self):
        return await journal.upload(Response(), UploadFile(filename='sample.jpg', file=io.BytesIO(b'fake fixture')), self.upload_id)

    async def test_decoder_failure_can_retry_same_upload(self):
        with patch.object(journal, 'process_media', AsyncMock(side_effect=AppError(422, 'INVALID_MEDIA', '测试失败'))):
            with self.assertRaises(AppError):
                await self.send()
        self.assertEqual(self.db.row['status'], 'failed')
        self.assertFalse(list((self.root / 'staging').iterdir()))
        with patch.object(journal, 'process_media', AsyncMock(return_value=DETAILS)):
            result = await self.send()
        self.assertEqual(result['data']['id'], self.upload_id)
        self.assertEqual(self.db.row['status'], 'ready')

    async def test_renamed_file_database_failure_is_unreadable_and_retryable(self):
        self.db.fail_commit = True
        with patch.object(journal, 'process_media', AsyncMock(return_value=DETAILS)):
            with self.assertRaises(RuntimeError):
                await self.send()
            self.assertEqual(self.db.row['status'], 'failed')
            self.assertIsNone(self.db.row['storage_path'])
            with self.assertRaises(AppError) as raised:
                await journal.media(self.upload_id, 'original')
            self.assertEqual(raised.exception.status, 404)
            await self.send()
        self.assertEqual(self.db.row['status'], 'ready')
        self.assertTrue((self.root / self.db.row['storage_path'] / 'original').is_file())

    async def test_stale_processing_lease_can_recover(self):
        with patch.object(journal, 'process_media', AsyncMock(side_effect=AppError(422, 'INVALID_MEDIA', '测试失败'))):
            with self.assertRaises(AppError):
                await self.send()
        self.db.row.update(status='processing', stale=True)
        with patch.object(journal, 'process_media', AsyncMock(return_value=DETAILS)):
            await self.send()
        self.assertEqual(self.db.row['status'], 'ready')

    async def test_cleanup_second_disk_failure_keeps_first_tombstone(self):
        first_id, second_id = uuid4(), uuid4()
        first = dict(id=first_id, status='ready', storage_path=f'assets/{first_id}/{uuid4()}')
        second = dict(id=second_id, status='ready', storage_path=f'assets/{second_id}/{uuid4()}')
        for row in (first, second):
            (self.root / row['storage_path']).mkdir(parents=True)
        self.db.row = first
        with patch('scripts.cleanup_journal_media.shutil.rmtree') as remove:
            await cleanup_one(self.db, first, self.root, 30, True)
            self.assertEqual(first['status'], 'cancelled')
            self.db.row = second
            remove.side_effect = OSError('模拟第二个文件删除失败')
            with self.assertRaises(OSError):
                await cleanup_one(self.db, second, self.root, 30, True)
        self.assertEqual(first['status'], 'cancelled')
        self.assertEqual(second['status'], 'cancelled')


if __name__ == '__main__':
    unittest.main()
