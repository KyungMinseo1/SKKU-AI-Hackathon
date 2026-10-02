import base64
import binascii
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db, utcnow
from app.models import ClassSession, ConceptNode, Course, StudentQuestion, TeacherQuestion, User, Week
from app.schemas import (
    MemoIn,
    QuestionCreate,
    QuestionMove,
    RecallIn,
    RefineIn,
    RefineOut,
    StudentQuestionOut,
    TeacherQuestionOut,
)
from app.security import require_student, require_teacher
from app.services.classify import classify_question_job
from app.services.filtering import find_banned
from app.services.graph import student_questions_out, teacher_questions_out
from app.services.refine import course_banned_words, refine_question

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["questions"])

JPEG_PREFIX = "data:image/jpeg;base64,"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
SESSION_CLOSED = "수업이 종료되어 질문을 등록할 수 없습니다"
QUESTION_NOT_FOUND = "질문을 찾을 수 없습니다"
RECALL_NOT_READY = "아직 리콜 퀴즈를 풀 수 없습니다"


async def _out(request: Request, db: AsyncSession, rows) -> list[StudentQuestionOut]:
    return await student_questions_out(db, rows, request.app.state.ctx.settings.RECALL_DELAY_MINUTES)


async def _my_question(db: AsyncSession, user: User, question_id: int) -> StudentQuestion:
    q = await db.get(StudentQuestion, question_id)
    if q is None or q.student_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, QUESTION_NOT_FOUND)
    return q


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
    return (await _out(request, db, [q]))[0]


@router.get("/me/questions", response_model=list[StudentQuestionOut])
async def my_questions(
    request: Request, user: User = Depends(require_student), db: AsyncSession = Depends(get_db)
):
    rows = (
        await db.scalars(
            select(StudentQuestion)
            .where(StudentQuestion.student_id == user.id)
            .order_by(StudentQuestion.created_at.desc(), StudentQuestion.id.desc())
        )
    ).all()
    return await _out(request, db, rows)


@router.patch("/me/questions/{question_id}/memo", response_model=StudentQuestionOut)
async def save_memo(
    question_id: int,
    body: MemoIn,
    request: Request,
    user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    q = await _my_question(db, user, question_id)
    q.memo = body.memo
    await db.commit()
    return (await _out(request, db, [q]))[0]


@router.post("/me/questions/{question_id}/recall", response_model=StudentQuestionOut)
async def answer_recall(
    question_id: int,
    body: RecallIn,
    request: Request,
    user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    q = await _my_question(db, user, question_id)
    out = (await _out(request, db, [q]))[0]
    if out.recall_due_at > utcnow():
        raise HTTPException(status.HTTP_409_CONFLICT, RECALL_NOT_READY)
    answer = body.answer.strip()
    if not answer:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "답변을 입력해 주세요")
    q.recall_answer = answer
    q.recall_answered_at = utcnow()
    await db.commit()
    return (await _out(request, db, [q]))[0]


@router.get("/questions/{question_id}/capture")
async def question_capture(
    question_id: int, user: User = Depends(require_student), db: AsyncSession = Depends(get_db)
):
    q = await db.get(StudentQuestion, question_id)
    if q is None or q.student_id != user.id or not q.capture_path or not Path(q.capture_path).is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "캡처를 찾을 수 없습니다")
    return FileResponse(q.capture_path, media_type="image/jpeg")


@router.patch("/teacher-questions/{question_id}", response_model=TeacherQuestionOut)
async def move_teacher_question(
    question_id: int,
    body: QuestionMove,
    request: Request,
    user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """교사가 마인드맵에서 질문을 다른 개념(또는 주차)으로 옮긴다. 학생 질문(저장소2)도 함께 갱신."""
    tq = await db.get(TeacherQuestion, question_id)
    course = await db.get(Course, tq.course_id) if tq else None
    if tq is None or course is None or course.teacher_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, QUESTION_NOT_FOUND)
    if body.concept_node_id is not None:
        node = await db.get(ConceptNode, body.concept_node_id)
        if node is None or node.course_id != tq.course_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "노드를 찾을 수 없습니다")
        node_id, week_id = node.id, node.week_id
    elif body.week_id is not None:
        week = await db.get(Week, body.week_id)
        if week is None or week.course_id != tq.course_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "주차를 찾을 수 없습니다")
        node_id, week_id = None, week.id
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "이동할 노드나 주차가 필요합니다")

    session = await db.get(ClassSession, tq.session_id)
    off_week = week_id != session.week_id
    tq.concept_node_id, tq.assigned_week_id, tq.off_week = node_id, week_id, off_week
    sq = await db.get(StudentQuestion, tq.student_question_id)
    if sq is not None:
        sq.concept_node_id, sq.assigned_week_id, sq.off_week = node_id, week_id, off_week
    await db.commit()
    out = (await teacher_questions_out(db, tq.course_id, [tq]))[0]
    await request.app.state.ctx.hub.publish(
        tq.session_id, {"type": "question.updated", "question": out.model_dump(mode="json")}
    )
    return out
