import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, update

from app import models  # noqa: F401 - register tables
from app.ai.llm import build_ai_clients
from app.config import get_settings
from app.context import AppContext
from app.db import Base, add_missing_columns, make_engine, make_sessionmaker
from app.models import Course, StudentQuestion, Week
from app.routers import auth, courses, live, questions, sessions
from app.services.classify import classify_question_job
from app.services.jobs import JobRunner
from app.services.live_hub import LiveHub

logging.basicConfig(level=logging.INFO)

RESTART_MESSAGE = "서버 재시작으로 중단됨"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    uploads = Path(settings.DATA_DIR) / "uploads"
    for sub in ("syllabus", "materials", "captures"):
        (uploads / sub).mkdir(parents=True, exist_ok=True)

    engine = make_engine(settings)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(add_missing_columns)
    sessionmaker = make_sessionmaker(engine)
    ctx = AppContext(settings, sessionmaker, build_ai_clients(settings), LiveHub(), JobRunner())
    app.state.ctx = ctx

    async with sessionmaker() as db:
        await db.execute(
            update(Course)
            .where(Course.syllabus_status == "parsing")
            .values(syllabus_status="failed", syllabus_error=RESTART_MESSAGE)
        )
        await db.execute(
            update(Week).where(Week.gen_status == "running").values(gen_status="failed", gen_error=RESTART_MESSAGE)
        )
        await db.commit()
        pending = (await db.scalars(select(StudentQuestion.id).where(StudentQuestion.status == "pending"))).all()
    for qid in pending:
        ctx.jobs.spawn(classify_question_job(ctx, qid))

    try:
        yield
    finally:
        await ctx.jobs.shutdown()
        await engine.dispose()


app = FastAPI(title="ASKKUP", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
for r in (auth.router, courses.router, sessions.router, questions.router, live.router):
    app.include_router(r)
