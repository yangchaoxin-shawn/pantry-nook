"""仅新建隔离数据库，验证旧快照登记、增量迁移和重复执行。"""
import asyncio
import json
from pathlib import Path
import sys
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from dotenv import load_dotenv
load_dotenv(ROOT/'backend/.env')
import asyncpg
from app.db import _db_config
from app.migrations import migrate,register_current_schema_migrations

async def main():
    config=_db_config();config['database']='postgres'
    admin=await asyncpg.connect(**config)
    results=[]
    try:
        for mode in ['fresh_snapshot','old_snapshot_no_history','old_snapshot_with_history']:
            name='pantry_nook_test_'+uuid4().hex
            await admin.execute('CREATE DATABASE "'+name+'"')
            connection=await asyncpg.connect(**{**config,'database':name})
            try:
                await connection.execute((ROOT/'backend/app/db/schema.sql').read_text(encoding='utf-8'))
                if mode!='fresh_snapshot':
                    await connection.execute("INSERT INTO dishes(name) VALUES($1)",'migration-only-test')
                before=[dict(x) for x in await connection.fetch('SELECT * FROM dishes ORDER BY id')]
                assert await register_current_schema_migrations(connection)
                assert await connection.fetchval('SELECT COUNT(*) FROM schema_migrations')==12
                assert await connection.fetchval("SELECT to_regclass('public.journal_entries')") is None
                if mode=='old_snapshot_with_history':
                    assert not await register_current_schema_migrations(connection)
                await migrate(connection)
                assert await connection.fetchval('SELECT COUNT(*) FROM schema_migrations')==13
                assert await connection.fetchval("SELECT to_regclass('public.journal_entries')")
                assert await connection.fetchval("SELECT to_regclass('public.journal_uploads')")
                await migrate(connection)
                assert await connection.fetchval('SELECT COUNT(*) FROM schema_migrations')==13
                assert [dict(x) for x in await connection.fetch('SELECT * FROM dishes ORDER BY id')]==before
                results.append({'case':mode,'database':name,'migration_count':13,'business_unchanged':True,'repeat_safe':True})
            finally:await connection.close()
    finally:await admin.close()
    output=ROOT/'.review/journal-migration-evidence.json'
    output.write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(json.dumps(results))

asyncio.run(main())
