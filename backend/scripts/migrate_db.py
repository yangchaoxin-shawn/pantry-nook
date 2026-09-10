"""先备份现有数据库，再执行增量迁移；不会清空数据。"""
import asyncio
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT / '.env')
from app.db import _db_config
from app.migrations import migrate
import asyncpg


async def main():
    config = _db_config()
    dump = shutil.which('pg_dump') or r'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'
    backup_dir = ROOT / '.backups'
    backup_dir.mkdir(exist_ok=True)
    target = backup_dir / (datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.dump')
    env = {**os.environ, 'PGPASSWORD': config['password']}
    subprocess.run([dump, '-h', config['host'], '-p', str(config['port']), '-U', config['user'],
                    '-d', config['database'], '-Fc', '-f', str(target)], env=env, check=True)
    print(f'备份已保存：{target.name}', flush=True)
    conn = await asyncpg.connect(**config)
    try:
        await migrate(conn)
    finally:
        await conn.close()
    print('增量迁移通过，原记录保留。')


if __name__ == '__main__':
    asyncio.run(main())
