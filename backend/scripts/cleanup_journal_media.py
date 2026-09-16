"""预览过期、无有效手记引用的媒体；默认不删除，--apply 才执行。

调用前同时备份数据库和 MEDIA_ROOT。只扫描数据库明确登记的资源目录，
不追踪软链接、不扫描未知磁盘目录，保留上传与发布幂等记录。
"""
import argparse
import asyncio
import os
from pathlib import Path
import shutil
import sys
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT / '.env')
from app.db import get_pool, close_pool
from app.journal_media import media_root, safe_path, PROCESS_LOCK


def cleanup_path(root: Path, row) -> Path:
    # 必须检查尚未 resolve 的每一层，不能让软链接别名绕过目录归属。
    parts = Path(row['storage_path']).parts
    if len(parts) != 3 or parts[:2] != ('assets', str(row['id'])):
        raise RuntimeError('媒体路径校验失败，未继续清理')
    UUID(parts[2])
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise RuntimeError('媒体目录包含软链接，未继续清理')
    if safe_path(row['storage_path']) != path:
        raise RuntimeError('媒体目录解析不一致')
    return path


async def cleanup_one(conn, row, root: Path, days: int, apply: bool):
    path = cleanup_path(root, row)
    print(f"{'删除' if apply else '预览'} {row['id']} {path}")
    if not apply:
        return
    # 先用短事务提交不可逆 tombstone；删盘异常不能使资源重新成为 ready。
    async with conn.transaction():
        await conn.execute('SELECT pg_advisory_xact_lock($1)', PROCESS_LOCK + 1)
        current = await conn.fetchrow('''SELECT u.* FROM journal_uploads u LEFT JOIN journal_entries e ON e.id=u.entry_id
            WHERE u.id=$1 AND u.status <> 'processing' AND u.storage_path=$3
            AND ((u.entry_id IS NULL AND u.updated_at < now() - $2 * interval '1 day')
                 OR (e.deleted_at < now() - $2 * interval '1 day')) FOR UPDATE OF u''',
            row['id'], days, row['storage_path'])
        if not current:
            return
        # 保留原过期时间，删盘失败后可立即重试；取消状态拒绝发布与访问。
        await conn.execute("UPDATE journal_uploads SET status='cancelled' WHERE id=$1", row['id'])
    if path.exists():
        shutil.rmtree(path)


async def main(days: int, apply: bool):
    root = media_root()
    pool = await get_pool()
    count = 0
    failures = 0
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch('''SELECT u.* FROM journal_uploads u LEFT JOIN journal_entries e ON e.id=u.entry_id
                WHERE u.status <> 'processing' AND u.storage_path IS NOT NULL
                AND ((u.entry_id IS NULL AND u.updated_at < now() - $1 * interval '1 day')
                    OR (e.deleted_at < now() - $1 * interval '1 day'))
                ORDER BY u.id''', days)
            for row in rows:
                count += 1
                try:
                    await cleanup_one(conn, row, root, days, apply)
                except OSError:
                    failures += 1
                    print(f"{row['id']} 删盘失败，取消状态已保留，可重试")
            print(f"候选 {count} 项；{'已执行' if apply else '只预览，未删除'}；失败 {failures} 项")
    finally:
        await close_pool()
    return 1 if failures else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--older-than-days', type=int, default=30)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.older_than_days < 1:
        parser.error('至少保留 1 天')
    raise SystemExit(asyncio.run(main(args.older_than_days, args.apply)))
