import asyncio
import logging
from pathlib import Path

from sqlalchemy import delete, func, select, update

from app.ai.prompts import (
    SYLLABUS_SYSTEM,
    WEB_RESEARCH_PROMPT,
    WEEK_FROM_MATERIAL_SYSTEM,
    WEEK_FROM_WEB_SYSTEM,
)
from app.ai.structured import SyllabusParse, WeekConcepts
from app.context import AppContext
from app.models import (
    ClassSession,
    ConceptNode,
    Course,
    Material,
    MaterialChunk,
    StudentQuestion,
    Week,
)
from app.services.documents import extract_chunks, extract_pdf_markdown
from app.services.graph import ensure_embeddings

log = logging.getLogger(__name__)

GENERATED_SOURCES = ("material", "web", "llm")
CHUNK_PREVIEW_CHARS = 600
CHUNK_INPUT_LIMIT = 24_000


def syllabus_dir(ctx: AppContext) -> Path:
    return Path(ctx.settings.DATA_DIR) / "uploads" / "syllabus"


def latest_syllabus_file(ctx: AppContext, course_id: int) -> Path | None:
    files = sorted(syllabus_dir(ctx).glob(f"{course_id}_*.pdf"), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None


async def parse_syllabus_job(ctx: AppContext, course_id: int) -> None:
    async with ctx.sessionmaker() as db:
        course = await db.get(Course, course_id)
        if course is None:
            return
        try:
            path = latest_syllabus_file(ctx, course_id)
            if path is None:
                raise FileNotFoundError("실라버스 파일을 찾을 수 없습니다")
            markdown = await asyncio.to_thread(extract_pdf_markdown, path)
            parsed = await ctx.ai.curriculum.json(
                SYLLABUS_SYSTEM, f"강의명: {course.name}\n\n{markdown}", SyllabusParse
            )

            # 기존 주차 전부 삭제(노드·교안·청크는 FK CASCADE). 질문이 없는 강좌만 여기까지 옴.
            week_ids = (await db.scalars(select(Week.id).where(Week.course_id == course_id))).all()
            if week_ids:
                old_files = (
                    await db.scalars(select(Material.stored_path).where(Material.week_id.in_(week_ids)))
                ).all()
                await db.execute(delete(ClassSession).where(ClassSession.course_id == course_id))
                await db.execute(delete(Week).where(Week.course_id == course_id))
                for f in old_files:
                    Path(f).unlink(missing_ok=True)

            seen: set[int] = set()
            new_weeks: list[Week] = []
            for sw in sorted(parsed.weeks, key=lambda w: w.week_no):
                if sw.week_no in seen:
                    continue
                seen.add(sw.week_no)
                week = Week(
                    course_id=course_id,
                    week_no=sw.week_no,
                    title=sw.title.strip() or f"{sw.week_no}주차",
                    description=sw.description.strip(),
                    is_lecture=sw.is_lecture,
                )
                db.add(week)
                await db.flush()
                new_weeks.append(week)
                for pos, topic in enumerate(t.strip().lstrip("-").strip() for t in sw.topics):
                    if topic:
                        db.add(
                            ConceptNode(
                                course_id=course_id,
                                week_id=week.id,
                                parent_id=None,
                                title=topic,
                                source="syllabus",
                                position=pos,
                            )
                        )
            course.syllabus_status = "done"
            course.syllabus_error = None
            await db.commit()
        except Exception as e:
            log.exception("syllabus parse failed for course %s", course_id)
            await db.rollback()
            course = await db.get(Course, course_id)
            if course is not None:
                course.syllabus_status = "failed"
                course.syllabus_error = str(e)[:500]
                await db.commit()
            return

    for week in new_weeks:
        if week.is_lecture:
            ctx.jobs.spawn(generate_week_job(ctx, week.id))


async def generate_week_job(ctx: AppContext, week_id: int) -> None:
    async with ctx.jobs.lock(f"week:{week_id}"), ctx.jobs.generation_sem:
        async with ctx.sessionmaker() as db:
            week = await db.get(Week, week_id)
            if week is None:
                return
            course = await db.get(Course, week.course_id)
            week.gen_status = "running"
            week.gen_error = None
            await db.commit()
            try:
                requeue = await _generate_week(ctx, db, course, week)
            except Exception as e:
                log.exception("week generation failed for week %s", week_id)
                await db.rollback()
                week = await db.get(Week, week_id)
                if week is not None:
                    week.gen_status = "failed"
                    week.gen_error = str(e)[:500]
                    await db.commit()
                return

            try:
                await ensure_embeddings(db, ctx.ai, course.id)
            except Exception:
                log.exception("embedding failed after generating week %s", week_id)
                await db.rollback()

            if requeue:
                await db.execute(
                    update(StudentQuestion)
                    .where(StudentQuestion.id.in_(requeue))
                    .values(status="pending", concept_node_id=None)
                )
                await db.commit()

    if requeue:
        from app.services.classify import classify_question_job

        for qid in requeue:
            ctx.jobs.spawn(classify_question_job(ctx, qid))


async def _generate_week(ctx: AppContext, db, course: Course, week: Week) -> list[int]:
    """LLM 생성 후 주차 그래프에 적용. 재분류할 질문 id 목록 반환. 성공 시 커밋까지 수행."""
    week_nodes = (
        await db.scalars(select(ConceptNode).where(ConceptNode.week_id == week.id).order_by(ConceptNode.id))
    ).all()
    syllabus_nodes = sorted(
        (n for n in week_nodes if n.source == "syllabus" and n.parent_id is None),
        key=lambda n: (n.position, n.id),
    )
    topic_lines = "\n".join(f"[topic:{n.id}] {n.title}" for n in syllabus_nodes) or "(없음)"
    common = (
        f"강의: {course.name}\n"
        f"주차: {week.week_no}주차 {week.title}\n"
        f"설명: {week.description or '(없음)'}\n"
        f"기존 실라버스 주제:\n{topic_lines}"
    )

    has_material = await db.scalar(
        select(func.count()).select_from(Material).where(Material.week_id == week.id, Material.status == "done")
    )
    week_chunk_ids: set[int] = set()
    if has_material:
        chunks = (
            await db.scalars(
                select(MaterialChunk)
                .where(MaterialChunk.week_id == week.id)
                .order_by(MaterialChunk.material_id, MaterialChunk.page_from, MaterialChunk.id)
            )
        ).all()
        week_chunk_ids = {c.id for c in chunks}
        lines: list[str] = []
        total = 0
        for c in chunks:
            line = f"[chunk:{c.id}] (p.{c.page_from}-{c.page_to}) {c.text[:CHUNK_PREVIEW_CHARS]}"
            if total + len(line) > CHUNK_INPUT_LIMIT:
                break
            lines.append(line)
            total += len(line) + 1
        content = f"{common}\n\n교안 청크:\n" + "\n".join(lines)
        result = await ctx.ai.curriculum.json(WEEK_FROM_MATERIAL_SYSTEM, content, WeekConcepts)
        gen_source = "material"
    else:
        topics = ", ".join(n.title for n in syllabus_nodes) or week.title
        notes = await ctx.ai.curriculum.research(
            WEB_RESEARCH_PROMPT.format(
                course=course.name, week_no=week.week_no, week_title=week.title, topics=topics
            ),
            query=f"{course.name} {week.title}",
        )
        content = common + (f"\n\n웹 조사 노트:\n{notes}" if notes else "")
        result = await ctx.ai.curriculum.json(WEEK_FROM_WEB_SYSTEM, content, WeekConcepts)
        gen_source = "web" if notes else "llm"

    # ---- 적용 ----
    by_id = {n.id: n for n in week_nodes}
    doomed = {n.id for n in week_nodes if n.source in GENERATED_SOURCES and not n.edited}
    survivors = [n for n in week_nodes if n.id not in doomed]
    for n in survivors:
        if n.parent_id in doomed:
            p = n.parent_id
            while p is not None and p in doomed:
                p = by_id[p].parent_id
            n.parent_id = p
            n.embedding = None  # 경로가 바뀌어 임베딩 텍스트도 바뀜
    requeue: list[int] = []
    if doomed:
        requeue = list(
            (
                await db.scalars(select(StudentQuestion.id).where(StudentQuestion.concept_node_id.in_(doomed)))
            ).all()
        )
        await db.flush()
        await db.execute(delete(ConceptNode).where(ConceptNode.id.in_(doomed)))

    next_pos: dict[int | None, int] = {}
    for n in survivors:
        next_pos[n.parent_id] = max(next_pos.get(n.parent_id, -1), n.position)

    def take_pos(parent_id: int | None) -> int:
        pos = next_pos.get(parent_id, -1) + 1
        next_pos[parent_id] = pos
        return pos

    syllabus_ids = {n.id for n in week_nodes if n.source == "syllabus"}
    for topic in result.topics:
        if topic.existing_topic_id is not None and topic.existing_topic_id in syllabus_ids:
            parent = by_id[topic.existing_topic_id]
            if not parent.summary.strip() and topic.summary.strip():
                parent.summary = topic.summary.strip()
                parent.embedding = None
        else:
            parent = ConceptNode(
                course_id=course.id,
                week_id=week.id,
                parent_id=None,
                title=topic.title.strip() or "주제",
                summary=topic.summary.strip(),
                source=gen_source,
                position=take_pos(None),
            )
            db.add(parent)
            await db.flush()
        for concept in topic.concepts:
            node = ConceptNode(
                course_id=course.id,
                week_id=week.id,
                parent_id=parent.id,
                title=concept.title.strip() or "개념",
                summary=concept.summary.strip(),
                source=gen_source,
                position=take_pos(parent.id),
            )
            db.add(node)
            await db.flush()
            linked = [cid for cid in concept.chunk_ids if cid in week_chunk_ids]
            if linked:
                await db.execute(
                    update(MaterialChunk).where(MaterialChunk.id.in_(linked)).values(concept_node_id=node.id)
                )

    week.gen_status = "done"
    week.gen_source = gen_source
    week.gen_error = None
    await db.commit()
    return requeue


async def process_material_job(ctx: AppContext, material_id: int) -> None:
    async with ctx.sessionmaker() as db:
        material = await db.get(Material, material_id)
        if material is None:
            return
        week = await db.get(Week, material.week_id)
        try:
            drafts = await asyncio.to_thread(extract_chunks, material.stored_path, material.kind)
            if not drafts:
                raise ValueError("교안에서 텍스트를 추출할 수 없습니다")
        except Exception as e:
            log.exception("material extraction failed for %s", material_id)
            material.status = "failed"
            material.error = str(e)[:500]
            await db.commit()
            return
        for d in drafts:
            db.add(
                MaterialChunk(
                    material_id=material.id,
                    week_id=material.week_id,
                    page_from=d.page_from,
                    page_to=d.page_to,
                    text=d.text,
                )
            )
        material.page_count = max(d.page_to for d in drafts)
        await db.commit()
        try:
            await ensure_embeddings(db, ctx.ai, week.course_id)
        except Exception:
            log.exception("embedding failed for material %s", material_id)
            await db.rollback()
        material = await db.get(Material, material_id)
        if material is None:
            return
        material.status = "done"
        material.error = None
        await db.commit()
        week_id = material.week_id
    ctx.jobs.spawn(generate_week_job(ctx, week_id))
