"""仅新建隔离数据库，验证旧快照登记、增量迁移和重复执行。"""
import asyncio
import hashlib
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
    assert config['host'] in ('localhost','127.0.0.1') and config['port']==55460, '仅允许本轮 55460 测试实例'
    admin=await asyncpg.connect(**config)
    results=[]
    try:
        for mode in ['fresh_snapshot','old_snapshot_no_history','old_snapshot_with_history','journal_013_with_photos']:
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
                legacy_entry=None
                if mode=='journal_013_with_photos':
                    path=ROOT/'backend/migrations/013_photo_journal.sql'
                    content=path.read_text(encoding='utf-8')
                    await connection.execute(content)
                    await connection.execute('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',path.name,hashlib.sha256(content.encode()).hexdigest())
                    legacy_entry=await connection.fetchrow("INSERT INTO journal_entries(client_request_id,request_sha256,entry_date,caption) VALUES($1,$2,DATE '2044-01-01',$3) RETURNING *",uuid4(),'a'*64,'migration 013 test')
                    photo_ids=[uuid4(),uuid4(),uuid4()]
                    # 视频排在第一项；封面必须回填第一张图片，不是第一份源文件。
                    for position,identifier in enumerate(photo_ids):
                        kind='video' if position==0 else 'image'
                        await connection.execute("INSERT INTO journal_uploads(id,sha256,status,original_name,original_size,details,entry_id,position) VALUES($1,$2,'ready',$3,10,$4::jsonb,$5,$6)",identifier,'b'*64,'test.mov' if kind=='video' else 'test.jpg',json.dumps({'kind':kind}),legacy_entry['id'],position)
                    uploads_before=[dict(x) for x in await connection.fetch('SELECT * FROM journal_uploads ORDER BY position')]
                await migrate(connection)
                assert await connection.fetchval('SELECT COUNT(*) FROM schema_migrations')==14
                assert await connection.fetchval("SELECT to_regclass('public.journal_entries')")
                assert await connection.fetchval("SELECT to_regclass('public.journal_uploads')")
                await migrate(connection)
                assert await connection.fetchval('SELECT COUNT(*) FROM schema_migrations')==14
                assert [dict(x) for x in await connection.fetch('SELECT * FROM dishes ORDER BY id')]==before
                if legacy_entry:
                    after=await connection.fetchrow('SELECT * FROM journal_entries WHERE id=$1',legacy_entry['id'])
                    assert after['cover_upload_id']==photo_ids[1]
                    assert all(after[key]==value for key,value in dict(legacy_entry).items())
                    assert [dict(x) for x in await connection.fetch('SELECT * FROM journal_uploads ORDER BY position')]==uploads_before
                results.append({'case':mode,'database':name,'migration_count':14,'business_unchanged':True,'repeat_safe':True,'legacy_cover_backfill':bool(legacy_entry)})
            finally:await connection.close()
    finally:await admin.close()
    output=ROOT/'.review/journal-migration-evidence.json'
    output.write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(json.dumps(results))

asyncio.run(main())
