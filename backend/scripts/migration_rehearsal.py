"""Restore a backup into a NEW isolated database; verify additive migration and re-run.

Never restores into the configured business database. Keeps the test database for inspection.
"""
import argparse
import asyncio
import os
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT / '.env')
import asyncpg
from app.db import _db_config
from app.migrations import migrate

TABLES = ('ingredients', 'dishes', 'meal_plans', 'meal_plan_dishes',
          'daily_battles', 'daily_battle_dishes', 'consumptions')


async def snapshot(conn):
    # Table identifiers come exclusively from the static allowlist above.
    return {table: await conn.fetchval(
        "SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'meal_slot' ORDER BY (to_jsonb(t) - 'meal_slot')::text), '[]'::jsonb)::text FROM "
        + table + ' t') for table in TABLES}


async def main(backup):
    config = _db_config()
    database = 'pantry_nook_test_' + uuid4().hex
    admin = await asyncpg.connect(**{**config, 'database': 'postgres'})
    try:
        await admin.execute('CREATE DATABASE "' + database + '"')
    finally:
        await admin.close()
    restore = shutil.which('pg_restore') or r'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'
    subprocess.run([restore, '--exit-on-error', '--no-owner', '--no-privileges',
                    '-h', config['host'], '-p', str(config['port']), '-U', config['user'],
                    '-d', database, str(backup)], env={**os.environ, 'PGPASSWORD': config['password']}, check=True)
    conn = await asyncpg.connect(**{**config, 'database': database})
    try:
        before = await snapshot(conn)
        await migrate(conn)
        assert await snapshot(conn) == before, 'Migration changed existing business data'
        versions = await conn.fetch('SELECT * FROM schema_migrations ORDER BY version')
        await migrate(conn)
        assert await conn.fetch('SELECT * FROM schema_migrations ORDER BY version') == versions
        assert await snapshot(conn) == before, 'Re-run changed business data'
        assert await conn.fetchval('SELECT count(*) FROM daily_battles WHERE meal_slot IS NOT NULL') == 0
        assert await conn.fetchval('SELECT count(*) FROM daily_battle_preparations') == 0
        print('PASS: backup restored; 7 original tables unchanged; migration re-run unchanged; old meal slots/preparations not invented.')
        print('Isolated database retained:', database)
    finally:
        await conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    args = parser.parse_args()
    if not args.backup.is_file():
        parser.error('Backup file does not exist')
    asyncio.run(main(args.backup.resolve()))
