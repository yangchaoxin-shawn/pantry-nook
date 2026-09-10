"""Container entry point: apply additive migrations before accepting traffic."""
import asyncio
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncpg
import uvicorn
from app.db import _db_config
from app.migrations import migrate, register_current_schema_migrations


async def upgrade():
    conn = await asyncpg.connect(**_db_config())
    try:
        await register_current_schema_migrations(conn)
        await migrate(conn)
    finally:
        await conn.close()


if __name__ == '__main__':
    asyncio.run(upgrade())
    uvicorn.run('app.main:app', host='0.0.0.0', port=int(os.getenv('PORT', '3000')))
