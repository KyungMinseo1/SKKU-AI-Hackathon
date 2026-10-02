import logging

import numpy as np
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.ai.prompts import CLASSIFY_SYSTEM
from app.ai.structured import ClassifyResult
from app.context import AppContext
from app.db import utcnow
from app.models import ConceptNode, MaterialChunk, StudentQuestion, TeacherQuestion, Week
from app.services.graph import concept_path, ensure_embeddings, teacher_questions_out

log = logging.getLogger(__name__)

HYBRID_TOP_K = 8
HYBRID_MAX = 24
FALLBACK_MAX = 150
SUMMARY_CHARS = 80


async def classify_question_job(ctx: AppContext, question_id: int) -> None:
    async with ctx.jobs.classify_sem:
        # 분류 중 재생성으로 선택 노드가 삭제되면 FK 위반 → 처음부터 다시.
        for _ in range(3):
            try:
                await _classify(ctx, question_id)
                return
            except IntegrityError:
                log.warning("classification of question %s hit integrity error; retrying", question_id)
        log.error("classification of question %s gave up after integrity errors", question_id)


async def _candidates(ctx: AppContext, db, q: StudentQuestion, session_week: Week, nodes, weeks):
    """(후보 노드 목록, 점수 dict | None)."""
    session_nodes = sorted((n for n in nodes if n.week_id == session_week.id), key=lambda n: n.id)
    others = [n for n in nodes if n.week_id != session_week.id]
    embedder = ctx.ai.embedder
    if embedder is not None and nodes and all(
        n.embedding is not None and n.embedding_model == embedder.model for n in nodes
    ):
        try:
            qv = (await embedder.embed([q.refined_text]))[0]
            scores = {n.id: float(np.frombuffer(n.embedding, dtype=np.float32) @ qv) for n in nodes}
            chunks = (
                await db.scalars(
                    select(MaterialChunk).where(
                        MaterialChunk.week_id.in_(weeks.keys()),
                        MaterialChunk.concept_node_id.is_not(None),
                        MaterialChunk.embedding.is_not(None),
                        MaterialChunk.embedding_model == embedder.model,
                    )
                )
            ).all()
            for c in chunks:
                if c.concept_node_id in scores:
                    s = float(np.frombuffer(c.embedding, dtype=np.float32) @ qv)
                    scores[c.concept_node_id] = max(scores[c.concept_node_id], s)
            rest = sorted(others, key=lambda n: -scores[n.id])[:HYBRID_TOP_K]
            return (session_nodes + rest)[:HYBRID_MAX], scores
        except Exception:
            log.exception("embedding candidate scoring failed; falling back to LLM-only candidates")
    rest = sorted(others, key=lambda n: (weeks[n.week_id].week_no, n.id))
    return (session_nodes + rest)[:FALLBACK_MAX], None


async def _classify(ctx: AppContext, question_id: int) -> None:
    async with ctx.sessionmaker() as db:
        q = await db.get(StudentQuestion, question_id)
        if q is None:
            return
        try:
            await ensure_embeddings(db, ctx.ai, q.course_id)
        except Exception:
            log.exception("ensure_embeddings failed during classification")
            await db.rollback()

        weeks = {w.id: w for w in (await db.scalars(select(Week).where(Week.course_id == q.course_id))).all()}
        session_week = weeks[q.session_week_id]
        nodes = (await db.scalars(select(ConceptNode).where(ConceptNode.course_id == q.course_id))).all()
        by_id = {n.id: n for n in nodes}
        candidates, scores = await _candidates(ctx, db, q, session_week, nodes, weeks)

        lines: list[str] = []
        for n in candidates:
            path = " > ".join(p["title"] for p in concept_path(by_id, n.id))
            line = f"[{n.id}] {weeks[n.week_id].week_no}주차 · {path} — {n.summary[:SUMMARY_CHARS]}"
            if scores is not None:
                line += f" (유사도 {scores[n.id]:.2f})"
            lines.append(line)
        candidate_block = "\n".join(lines) if lines else "후보 개념 없음 — concept_node_id는 null"
        content = (
            f"현재 수업 주차: {session_week.week_no}주차 {session_week.title}\n"
            f"학생 질문: {q.refined_text}\n\n"
            f"후보 개념:\n{candidate_block}"
        )
        system = CLASSIFY_SYSTEM.format(week_no=session_week.week_no)

        result: ClassifyResult | None = None
        for attempt in range(2):
            try:
                r = await ctx.ai.curriculum.json(system, content, ClassifyResult)
                if not r.keyword.strip():
                    raise ValueError("empty keyword")
                result = r
                break
            except Exception:
                log.exception("classification LLM call failed (attempt %d)", attempt + 1)

        now = utcnow()
        if result is not None:
            candidate_ids = {n.id for n in candidates}
            node = by_id.get(result.concept_node_id) if result.concept_node_id in candidate_ids else None
            q.status = "classified"
            q.concept_node_id = node.id if node else None
            q.assigned_week_id = node.week_id if node else q.session_week_id
            q.question_type = result.question_type.value
            q.keyword = result.keyword.strip()[:40]
            q.classified_at = now
        else:
            q.status = "failed"
            q.concept_node_id = None
            q.assigned_week_id = q.session_week_id
            q.question_type = None
            q.keyword = q.refined_text[:12]
        q.off_week = q.assigned_week_id != q.session_week_id

        tq = await db.scalar(select(TeacherQuestion).where(TeacherQuestion.student_question_id == q.id))
        created = tq is None
        if tq is None:
            tq = TeacherQuestion(student_question_id=q.id, created_at=q.created_at)
            db.add(tq)
        tq.course_id = q.course_id
        tq.session_id = q.session_id
        tq.assigned_week_id = q.assigned_week_id
        tq.concept_node_id = q.concept_node_id
        tq.question_type = q.question_type
        tq.keyword = q.keyword or q.refined_text[:12]
        tq.refined_text = q.refined_text
        tq.off_week = q.off_week
        tq.classified_at = now
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise

        out = (await teacher_questions_out(db, q.course_id, [tq]))[0]
        session_id = q.session_id
    await ctx.hub.publish(
        session_id,
        {"type": "question.created" if created else "question.updated", "question": out.model_dump(mode="json")},
    )
