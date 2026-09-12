"""增量迁移：保存版本与内容摘要，事务内应用，禁止改写已执行版本。"""
import hashlib
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION_LOCK_ID = 726140901


def _paths() -> list[Path]:
    return sorted(MIGRATIONS.glob("*.sql"))


async def _ensure_migration_table(conn) -> None:
    await conn.execute('''CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())''')


async def _is_current_schema(conn) -> bool:
    """Return true only when the current schema snapshot already contains every migration."""
    tables = await conn.fetchval(
        """SELECT COUNT(*)::int
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])""",
        ["daily_battle_preparations", "inventory_adjustments", "inventory_recovery_merges"],
    )
    if tables != 3:
        return False

    columns = await conn.fetch(
        """SELECT table_name, column_name
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])""",
        ["ingredients", "meal_plans", "daily_battles", "daily_battle_preparations"],
    )
    present = {(row["table_name"], row["column_name"]) for row in columns}
    required = {
        ("ingredients", "stock_text"),
        ("ingredients", "stock_value"),
        ("ingredients", "stock_unit"),
        ("meal_plans", "dish_signature"),
        ("daily_battles", "meal_slot"),
        ("daily_battle_preparations", "pending_ingredient_name"),
        ("daily_battle_preparations", "planned_quantity_unit"),
    }
    legacy = {
        ("ingredients", "quantity_text"),
        ("ingredients", "quantity_value"),
        ("ingredients", "quantity_unit"),
        ("ingredients", "remaining_text"),
        ("ingredients", "remaining_value"),
        ("ingredients", "remaining_unit"),
        ("ingredients", "purchase_date"),
    }
    return required.issubset(present) and not legacy.intersection(present)


async def register_current_schema_migrations(conn) -> bool:
    """Record historical migrations for the complete schema used by a new database.

    PostgreSQL's init hook installs ``schema.sql`` as a current schema snapshot.  Replaying
    historical migrations against that snapshot would reference columns that no longer exist.
    This function records their checksums only when the schema passes an explicit current-state
    check and migration history is empty.  Existing or partially upgraded databases keep using
    the normal additive migration path.
    """
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", MIGRATION_LOCK_ID)
        await _ensure_migration_table(conn)
        if await conn.fetchval("SELECT COUNT(*)::int FROM schema_migrations") != 0:
            return False
        if not await _is_current_schema(conn):
            return False
        for path in _paths():
            content = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(content.encode()).hexdigest()
            await conn.execute(
                "INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)",
                path.name,
                checksum,
            )
        return True


async def migrate(conn):
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", MIGRATION_LOCK_ID)
        await _ensure_migration_table(conn)
        for path in _paths():
            content = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(content.encode()).hexdigest()
            previous = await conn.fetchval("SELECT checksum FROM schema_migrations WHERE version=$1", path.name)
            if previous:
                if previous != checksum:
                    raise RuntimeError(f"已执行的迁移发生变更：{path.name}")
                continue
            await conn.execute(content)
            await conn.execute("INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)", path.name, checksum)
