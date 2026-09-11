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
        "SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'meal_slot' - 'dish_signature' ORDER BY (to_jsonb(t) - 'meal_slot' - 'dish_signature')::text), '[]'::jsonb)::text FROM "
        + table + ' t') for table in TABLES}


async def plan_deduplication_state(conn):
    plans = [dict(row) for row in await conn.fetch('SELECT id, name, created_at, updated_at FROM meal_plans ORDER BY id')]
    dishes = [dict(row) for row in await conn.fetch('SELECT meal_plan_id, dish_id, position FROM meal_plan_dishes ORDER BY meal_plan_id, position')]
    battles = {row['id']: row['meal_plan_id'] for row in await conn.fetch('SELECT id, meal_plan_id FROM daily_battles ORDER BY id')}
    signatures = {}
    for row in dishes:
        signatures.setdefault(row['meal_plan_id'], []).append(row['dish_id'])
    signatures = {plan_id: ','.join(str(id_) for id_ in sorted(ids)) for plan_id, ids in signatures.items()}
    keeper_by_signature = {}
    duplicate_to_keeper = {}
    for plan in plans:
        signature = signatures[plan['id']]
        keeper = keeper_by_signature.setdefault(signature, plan['id'])
        if keeper != plan['id']:
            duplicate_to_keeper[plan['id']] = keeper
    return {
        'plans': plans,
        'dishes': dishes,
        'battles': battles,
        'duplicate_to_keeper': duplicate_to_keeper,
    }


async def assert_plan_deduplication(conn, before, stable_before):
    duplicate_ids = set(before['duplicate_to_keeper'])
    expected_plans = [plan for plan in before['plans'] if plan['id'] not in duplicate_ids]
    actual_plans = [dict(row) for row in await conn.fetch('SELECT id, name, created_at, updated_at FROM meal_plans ORDER BY id')]
    assert actual_plans == expected_plans, 'Unexpected meal plan data changed during deduplication'
    expected_dishes = [row for row in before['dishes'] if row['meal_plan_id'] not in duplicate_ids]
    actual_dishes = [dict(row) for row in await conn.fetch('SELECT meal_plan_id, dish_id, position FROM meal_plan_dishes ORDER BY meal_plan_id, position')]
    assert actual_dishes == expected_dishes, 'Unexpected meal plan dishes changed during deduplication'
    actual_battles = {row['id']: row['meal_plan_id'] for row in await conn.fetch('SELECT id, meal_plan_id FROM daily_battles ORDER BY id')}
    expected_battles = {
        id_: before['duplicate_to_keeper'].get(plan_id, plan_id)
        for id_, plan_id in before['battles'].items()
    }
    assert actual_battles == expected_battles, 'Meal references were not moved to the retained plan'
    signatures = await conn.fetch('SELECT dish_signature, COUNT(*)::int AS count FROM meal_plans GROUP BY dish_signature')
    assert all(row['dish_signature'] and row['count'] == 1 for row in signatures), 'Duplicate signatures remain'
    current = await snapshot(conn)
    for table in ('ingredients', 'dishes', 'daily_battle_dishes', 'consumptions'):
        assert current[table] == stable_before[table], f'Unexpected changes in {table}'


async def main(backup, expect_plan_deduplication=False):
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
        plan_before = await plan_deduplication_state(conn) if expect_plan_deduplication else None
        await migrate(conn)
        if expect_plan_deduplication:
            await assert_plan_deduplication(conn, plan_before, before)
        else:
            assert await snapshot(conn) == before, 'Migration changed existing business data'
        migrated = await snapshot(conn)
        versions = await conn.fetch('SELECT * FROM schema_migrations ORDER BY version')
        await migrate(conn)
        assert await conn.fetch('SELECT * FROM schema_migrations ORDER BY version') == versions
        assert await snapshot(conn) == migrated, 'Re-run changed business data'
        if expect_plan_deduplication:
            print('PASS: duplicate plans merged; menu references retained; unrelated data unchanged; migration re-run unchanged.')
        else:
            assert await conn.fetchval('SELECT count(*) FROM daily_battles WHERE meal_slot IS NOT NULL') == 0
            assert await conn.fetchval('SELECT count(*) FROM daily_battle_preparations') == 0
            print('PASS: backup restored; 7 original tables unchanged; migration re-run unchanged; old meal slots/preparations not invented.')
        print('Isolated database retained:', database)
    finally:
        await conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('--expect-plan-deduplication', action='store_true')
    args = parser.parse_args()
    if not args.backup.is_file():
        parser.error('Backup file does not exist')
    asyncio.run(main(args.backup.resolve(), args.expect_plan_deduplication))
