import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db, utcnow
from app.models import ClassSession, SessionParticipant, StudentQuestion, TeacherQuestion, User, Week
from app.routers.common import open_session_of, owned_course, owned_session, session_out
from app.schemas import JoinIn, SessionCreate, SessionOut, SessionSummary, TeacherQuestionOut
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


async def _unique_open_code(db: AsyncSession, exclude_id: int | None = None) -> str:
    for _ in range(20):
        code = _new_code()
        clash = await db.scalar(
            select(ClassSession.id).where(
                ClassSession.code == code, ClassSession.status == "open", ClassSession.id != (exclude_id or 0)
            )
        )
        if clash is None:
            return code
    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "수업 코드를 만들 수 없습니다. 다시 시도해 주세요")


@router.get("/courses/{course_id}/sessions", response_model=list[SessionSummary])
async def list_sessions(course_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    await owned_course(db, user, course_id)
    sessions = (
        await db.scalars(
            select(ClassSession)
            .where(ClassSession.course_id == course_id)
            .order_by(ClassSession.opened_at.desc(), ClassSession.id.desc())
        )
    ).all()
    counts = dict(
        (
            await db.execute(
                select(StudentQuestion.session_id, func.count())
                .where(StudentQuestion.course_id == course_id)
                .group_by(StudentQuestion.session_id)
            )
        ).all()
    )
    return [
        SessionSummary(**(await session_out(db, s)).model_dump(), question_count=counts.get(s.id, 0))
        for s in sessions
    ]


@router.post("/sessions/{session_id}/reopen", response_model=SessionOut)
async def reopen_session(
    session_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    session = await owned_session(db, user, session_id)
    if session.status == "open":
        return await session_out(db, session)
    existing = await open_session_of(db, session.course_id)
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 진행 중인 수업이 있습니다. 먼저 종료해 주세요")
    clash = await db.scalar(
        select(ClassSession.id).where(ClassSession.code == session.code, ClassSession.status == "open")
    )
    if clash is not None:
        session.code = await _unique_open_code(db, session.id)
    session.status = "open"
    session.closed_at = None
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        session.code = await _unique_open_code(db, session.id)
        session.status = "open"
        session.closed_at = None
        await db.commit()
    return await session_out(db, session)


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
    joined = await db.scalar(
        select(SessionParticipant.id).where(
            SessionParticipant.session_id == session.id, SessionParticipant.student_id == user.id
        )
    )
    if joined is None:
        db.add(SessionParticipant(session_id=session.id, student_id=user.id))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
    return await session_out(db, session)


@router.get("/me/sessions", response_model=list[SessionOut])
async def my_sessions(user: User = Depends(require_student), db: AsyncSession = Depends(get_db)):
    """참여했거나 질문을 남긴 수업 — 최근 순. 진행 중이면 코드로 다시 들어갈 수 있다."""
    joined = select(SessionParticipant.session_id).where(SessionParticipant.student_id == user.id)
    asked = select(StudentQuestion.session_id).where(StudentQuestion.student_id == user.id)
    sessions = (
        await db.scalars(
            select(ClassSession)
            .where(ClassSession.id.in_(joined.union(asked)))
            .order_by(ClassSession.opened_at.desc(), ClassSession.id.desc())
        )
    ).all()
    return [await session_out(db, s) for s in sessions]
