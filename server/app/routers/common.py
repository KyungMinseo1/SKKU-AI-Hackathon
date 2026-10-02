"""라우터 공용 조회·소유권 헬퍼."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClassSession, Course, Material, User, Week
from app.schemas import SessionOut

COURSE_NOT_FOUND = "강의를 찾을 수 없습니다"


async def owned_course(db: AsyncSession, user: User, course_id: int) -> Course:
    course = await db.get(Course, course_id)
    if course is None or course.teacher_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, COURSE_NOT_FOUND)
    return course


async def owned_week(db: AsyncSession, user: User, week_id: int) -> tuple[Week, Course]:
    week = await db.get(Week, week_id)
    course = await db.get(Course, week.course_id) if week else None
    if week is None or course is None or course.teacher_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "주차를 찾을 수 없습니다")
    return week, course


async def owned_material(db: AsyncSession, user: User, material_id: int) -> tuple[Material, Week]:
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "교안을 찾을 수 없습니다")
    week, _ = await owned_week(db, user, material.week_id)
    return material, week


async def owned_session(db: AsyncSession, user: User, session_id: int) -> ClassSession:
    session = await db.get(ClassSession, session_id)
    course = await db.get(Course, session.course_id) if session else None
    if session is None or course is None or course.teacher_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "수업을 찾을 수 없습니다")
    return session


async def session_out(db: AsyncSession, session: ClassSession) -> SessionOut:
    course = await db.get(Course, session.course_id)
    week = await db.get(Week, session.week_id)
    return SessionOut(
        id=session.id,
        course_id=course.id,
        course_name=course.name,
        week_id=week.id,
        week_no=week.week_no,
        week_title=week.title,
        code=session.code,
        status=session.status,
        opened_at=session.opened_at,
        closed_at=session.closed_at,
    )


async def open_session_of(db: AsyncSession, course_id: int) -> ClassSession | None:
    return await db.scalar(
        select(ClassSession)
        .where(ClassSession.course_id == course_id, ClassSession.status == "open")
        .order_by(ClassSession.id.desc())
        .limit(1)
    )
