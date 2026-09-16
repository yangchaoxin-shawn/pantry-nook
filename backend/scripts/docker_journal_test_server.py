"""仅供独立 Docker 媒体验证；数据库和媒体卷均保留，不接触业务库。"""
import asyncio
import os
from pathlib import Path
import re
import sys

import asyncpg
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from isolated_server import prepare
from app.db import _db_config
from app.migrations import migrate


async def configure() -> tuple[str, Path]:
    if os.getenv('PANTRY_JOURNAL_DOCKER_TEST') != 'true' or os.getenv('APP_ENV') != 'test':
        raise RuntimeError('只允许显式测试容器启动')
    media = Path(os.environ['MEDIA_ROOT']).resolve()
    if 'test' not in media.name:
        raise RuntimeError('媒体目录必须包含 test 标记')
    media.mkdir(parents=True, exist_ok=True)
    marker = media / '.pantry-test-database'
    if marker.exists():
        database = marker.read_text(encoding='utf-8').strip()
        if not re.fullmatch(r'pantry_nook_test_[0-9a-f]{32}', database):
            raise RuntimeError('媒体与数据库标记无效')
        connection = await asyncpg.connect(**{**_db_config(), 'database': database})
        try:
            await migrate(connection)
        finally:
            await connection.close()
    else:
        database = await prepare()
        marker.write_text(database, encoding='utf-8')
    return database, media


if __name__ == '__main__':
    database, media = asyncio.run(configure())
    os.environ['DB_NAME'] = database
    os.environ['MEDIA_ROOT'] = str(media)
    from app.main import app

    @app.middleware('http')
    async def isolated_marker(request, call_next):
        response = await call_next(request)
        if request.url.path == '/health':
            response.headers['X-Pantry-Nook-Test-Database'] = database
            response.headers['X-Pantry-Nook-Test-Media'] = database
        return response

    print(f'Docker 媒体测试数据库：{database}', flush=True)
    uvicorn.run(app, host='0.0.0.0', port=3000)
