from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from fastapi import Request
from sqlalchemy import URL, event
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


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.ctx.sessionmaker() as session:
        yield session
