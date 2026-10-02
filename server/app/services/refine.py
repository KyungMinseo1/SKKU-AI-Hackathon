from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.llm import AIClients
from app.ai.prompts import REFINE_SYSTEM
from app.ai.structured import RefineResult
from app.config import get_settings
from app.models import BannedWord, ClassSession, ConceptNode, Course, Week
from app.schemas import RefineOut
from app.services.filtering import find_banned

NO_TEXT = "(텍스트 없음 – 화면 표시만 있음)"
IMAGE_UNAVAILABLE = "학생이 화면에 표시했으나 이미지는 제공되지 않음"


async def course_banned_words(db: AsyncSession, course_id: int) -> list[str]:
    return list((await db.scalars(select(BannedWord.word).where(BannedWord.course_id == course_id))).all())


async def refine_question(
    db: AsyncSession,
    ai: AIClients,
    session: ClassSession,
    raw_text: str,
    image: str | None,
    previous_refined: str | None,
    feedback: str | None,
) -> RefineOut:
    words = await course_banned_words(db, session.course_id)
    for text in (raw_text, feedback or ""):
        hit = find_banned(text, words)
        if hit:
            return RefineOut(
                status="blocked",
                reason=f"부적절한 표현('{hit}')이 포함되어 있어요. 수정 후 다시 시도해 주세요.",
            )

    course = await db.get(Course, session.course_id)
    week = await db.get(Week, session.week_id)
    nodes = (
        await db.scalars(
            select(ConceptNode).where(ConceptNode.week_id == week.id).order_by(ConceptNode.position, ConceptNode.id)
        )
    ).all()
    by_id = {n.id: n for n in nodes}
    node_titles = [
        f"{by_id[n.parent_id].title} > {n.title}" if n.parent_id in by_id else n.title for n in nodes
    ]

    lines = [
        f"강의: {course.name}",
        f"현재 주차: {week.week_no}주차 {week.title}",
        "주차 주제: " + (", ".join(node_titles) if node_titles else "(없음)"),
        f"학생 입력: {raw_text.strip() or NO_TEXT}",
    ]
    if previous_refined:
        lines.append(f"이전에 다듬은 질문: {previous_refined}")
    if feedback:
        lines.append(f"수정 요청: {feedback}")

    supports_images = get_settings().QUESTION_LLM_SUPPORTS_IMAGES
    if image and not supports_images:
        lines.append(IMAGE_UNAVAILABLE)
    text = "\n".join(lines)
    content: str | list[dict]
    if image and supports_images:
        content = [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": image}},
        ]
    else:
        content = text

    result = await ai.question.json(REFINE_SYSTEM, content, RefineResult)
    if not result.appropriate:
        return RefineOut(status="blocked", reason=result.block_reason or "수업과 관련된 질문만 등록할 수 있어요.")
    return RefineOut(status="ok", refined_text=result.refined_question.strip())
