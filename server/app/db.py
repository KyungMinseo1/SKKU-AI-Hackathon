from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from fastapi import Request
from sqlalchemy import URL, Connection, event, inspect
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import Settings


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    """Naive UTC timestamp (stored as-is in SQLite)."""
    return datetime.now(UTC).replace(tzinfo=None)


def make_engine(settings: Settings) -> AsyncEngine:
    db_path = Path(settings.DATA_DIR).resolve() / "askkup.db"
    url = URL.create("sqlite+aiosqlite", database=str(db_path))
    engine = create_async_engine(url, connect_args={"timeout": 30})

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record) -> None:
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    return engine


def add_missing_columns(conn: Connection) -> None:
    """create_all은 기존 테이블에 컬럼을 추가하지 않으므로, 새 nullable/기본값 컬럼만 ALTER로 보충한다."""
    insp = inspect(conn)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing:
                continue
            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col.type.compile(conn.dialect)}'
            if col.server_default is not None:
                ddl += f" DEFAULT '{col.server_default.arg}'"
            conn.exec_driver_sql(ddl)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.ctx.sessionmaker() as session:
        yield session
