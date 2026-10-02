import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db, utcnow
from app.models import ClassSession, TeacherQuestion, User, Week
from app.routers.common import open_session_of, owned_course, owned_session, session_out
from app.schemas import JoinIn, SessionCreate, SessionOut, TeacherQuestionOut
from app.security import require_student, require_teacher
from app.services.graph import teacher_questions_out

router = APIRouter(prefix="/api", tags=["sessions"])

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))


@router.post("/courses/{course_id}/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def open_session(
    course_id: int,
    body: SessionCreate,
    response: Response,
    user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    await owned_course(db, user, course_id)
    existing = await open_session_of(db, course_id)
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return await session_out(db, existing)
    week = await db.get(Week, body.week_id)
    if week is None or week.course_id != course_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "주차를 찾을 수 없습니다")
    for _ in range(20):
        code = _new_code()
        clash = await db.scalar(
            select(ClassSession.id).where(ClassSession.code == code, ClassSession.status == "open")
        )
        if clash is not None:
            continue
        session = ClassSession(course_id=course_id, week_id=week.id, code=code, status="open")
        db.add(session)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            continue
        return await session_out(db, session)
    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "수업 코드를 만들 수 없습니다. 다시 시도해 주세요")


@router.post("/sessions/{session_id}/close", response_model=SessionOut)
async def close_session(
    session_id: int, request: Request, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    session = await owned_session(db, user, session_id)
    if session.status == "open":
        session.status = "closed"
        session.closed_at = utcnow()
        await db.commit()
        await request.app.state.ctx.hub.publish(session.id, {"type": "session.closed"})
    return await session_out(db, session)


@router.get("/sessions/{session_id}", response_model=SessionOut)
async def get_session(session_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    return await session_out(db, await owned_session(db, user, session_id))


@router.get("/sessions/{session_id}/questions", response_model=list[TeacherQuestionOut])
async def session_questions(
    session_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    session = await owned_session(db, user, session_id)
    rows = (
        await db.scalars(
            select(TeacherQuestion)
            .where(TeacherQuestion.session_id == session.id)
            .order_by(TeacherQuestion.created_at, TeacherQuestion.id)
        )
    ).all()
    return await teacher_questions_out(db, session.course_id, rows)


@router.post("/sessions/join", response_model=SessionOut)
async def join_session(body: JoinIn, user: User = Depends(require_student), db: AsyncSession = Depends(get_db)):
    code = body.code.strip().upper()
    session = await db.scalar(
        select(ClassSession).where(ClassSession.code == code, ClassSession.status == "open")
    )
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "유효하지 않거나 종료된 수업 코드입니다")
    return await session_out(db, session)
