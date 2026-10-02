import base64
import binascii
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import ClassSession, StudentQuestion, User
from app.schemas import QuestionCreate, RefineIn, RefineOut, StudentQuestionOut
from app.security import require_student
from app.services.classify import classify_question_job
from app.services.filtering import find_banned
from app.services.graph import student_questions_out
from app.services.refine import course_banned_words, refine_question

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["questions"])

JPEG_PREFIX = "data:image/jpeg;base64,"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
SESSION_CLOSED = "수업이 종료되어 질문을 등록할 수 없습니다"


def _decode_image(image: str | None) -> bytes | None:
    if not image:
        return None
    if not image.startswith(JPEG_PREFIX):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "JPEG 이미지(data URL)만 첨부할 수 있습니다")
    payload = image[len(JPEG_PREFIX) :]
    if len(payload) > (MAX_IMAGE_BYTES * 4) // 3 + 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지 크기는 5MB 이하여야 합니다")
    try:
        data = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지를 읽을 수 없습니다") from None
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지 크기는 5MB 이하여야 합니다")
    return data


async def _open_session(db: AsyncSession, session_id: int) -> ClassSession:
    session = await db.get(ClassSession, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "수업을 찾을 수 없습니다")
    if session.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, SESSION_CLOSED)
    return session


@router.post("/questions/refine", response_model=RefineOut)
async def refine(
    body: RefineIn, request: Request, user: User = Depends(require_student), db: AsyncSession = Depends(get_db)
):
    if not body.raw_text.strip() and not body.image:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "질문 내용이나 펜 표시가 필요합니다")
    session = await _open_session(db, body.session_id)
    _decode_image(body.image)
    try:
        return await refine_question(
            db,
            request.app.state.ctx.ai,
            session,
            body.raw_text,
            body.image,
            body.previous_refined,
            body.feedback,
        )
    except Exception:
        log.exception("refine LLM call failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "AI 응답에 실패했습니다. 잠시 후 다시 시도해 주세요"
        ) from None


@router.post("/questions", response_model=StudentQuestionOut, status_code=status.HTTP_201_CREATED)
async def submit_question(
    body: QuestionCreate, request: Request, user: User = Depends(require_student), db: AsyncSession = Depends(get_db)
):
    session = await _open_session(db, body.session_id)
    if find_banned(body.refined_text, await course_banned_words(db, session.course_id)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "부적절한 표현이 포함되어 있습니다")
    image = _decode_image(body.image)
    ctx = request.app.state.ctx
    capture_path: str | None = None
    if image is not None:
        folder = Path(ctx.settings.DATA_DIR) / "uploads" / "captures"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{uuid.uuid4().hex}.jpg"
        path.write_bytes(image)
        capture_path = str(path)
    q = StudentQuestion(
        student_id=user.id,
        course_id=session.course_id,
        session_id=session.id,
        session_week_id=session.week_id,
        raw_text=body.raw_text.strip(),
        capture_path=capture_path,
        refined_text=body.refined_text.strip(),
        refine_rounds=body.refine_rounds,
        status="pending",
    )
    db.add(q)
    await db.commit()
    ctx.jobs.spawn(classify_question_job(ctx, q.id))
    return (await student_questions_out(db, [q]))[0]


@router.get("/me/questions", response_model=list[StudentQuestionOut])
async def my_questions(user: User = Depends(require_student), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.scalars(
            select(StudentQuestion)
            .where(StudentQuestion.student_id == user.id)
            .order_by(StudentQuestion.created_at.desc(), StudentQuestion.id.desc())
        )
    ).all()
    return await student_questions_out(db, rows)


@router.get("/questions/{question_id}/capture")
async def question_capture(
    question_id: int, user: User = Depends(require_student), db: AsyncSession = Depends(get_db)
):
    q = await db.get(StudentQuestion, question_id)
    if q is None or q.student_id != user.id or not q.capture_path or not Path(q.capture_path).is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "캡처를 찾을 수 없습니다")
    return FileResponse(q.capture_path, media_type="image/jpeg")
