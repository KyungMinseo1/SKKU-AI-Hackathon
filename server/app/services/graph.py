from collections.abc import Iterable, Sequence

import numpy as np
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.llm import AIClients
from app.models import (
    ClassSession,
    ConceptNode,
    Course,
    MaterialChunk,
    StudentQuestion,
    TeacherQuestion,
    Week,
)
from app.schemas import (
    CourseRef,
    PathItem,
    QuestionType,
    StudentQuestionOut,
    TeacherQuestionOut,
    WeekRef,
)


def node_embedding_text(node: ConceptNode, parent: ConceptNode | None, week: Week) -> str:
    return (
        f"{week.week_no}주차 {week.title} > "
        f"{parent.title + ' > ' if parent else ''}{node.title}: {node.summary}"
    )


async def ensure_embeddings(db: AsyncSession, ai: AIClients, course_id: int) -> None:
    embedder = ai.embedder
    if embedder is None:
        return
    model = embedder.model
    weeks = {w.id: w for w in (await db.scalars(select(Week).where(Week.course_id == course_id))).all()}
    nodes = (await db.scalars(select(ConceptNode).where(ConceptNode.course_id == course_id))).all()
    by_id = {n.id: n for n in nodes}
    stale_nodes = [n for n in nodes if n.embedding is None or n.embedding_model != model]
    stale_chunks = []
    if weeks:
        stale_chunks = (
            await db.scalars(
                select(MaterialChunk).where(
                    MaterialChunk.week_id.in_(weeks.keys()),
                    (MaterialChunk.embedding.is_(None)) | (MaterialChunk.embedding_model.is_distinct_from(model)),
                )
            )
        ).all()
    if not stale_nodes and not stale_chunks:
        return
    texts = [
        node_embedding_text(n, by_id.get(n.parent_id) if n.parent_id else None, weeks[n.week_id])
        for n in stale_nodes
    ] + [c.text for c in stale_chunks]
    vectors = await embedder.embed(texts)
    for row, vec in zip([*stale_nodes, *stale_chunks], vectors, strict=True):
        row.embedding = np.asarray(vec, dtype=np.float32).tobytes()
        row.embedding_model = model
    await db.commit()


def concept_path(nodes_by_id: dict[int, ConceptNode], node_id: int | None) -> list[dict]:
    path: list[dict] = []
    seen: set[int] = set()
    current = nodes_by_id.get(node_id) if node_id is not None else None
    while current is not None and current.id not in seen:
        seen.add(current.id)
        path.append({"id": current.id, "title": current.title})
        current = nodes_by_id.get(current.parent_id) if current.parent_id is not None else None
    path.reverse()
    return path


def subtree_ids(nodes: Iterable[ConceptNode], root_id: int) -> set[int]:
    children: dict[int | None, list[int]] = {}
    for n in nodes:
        children.setdefault(n.parent_id, []).append(n.id)
    ids: set[int] = set()
    stack = [root_id]
    while stack:
        nid = stack.pop()
        if nid in ids:
            continue
        ids.add(nid)
        stack.extend(children.get(nid, ()))
    return ids


async def delete_subtree(db: AsyncSession, node: ConceptNode) -> None:
    nodes = (await db.scalars(select(ConceptNode).where(ConceptNode.course_id == node.course_id))).all()
    ids = subtree_ids(nodes, node.id)
    new_parent = node.parent_id
    for model in (StudentQuestion, TeacherQuestion):
        await db.execute(
            update(model).where(model.concept_node_id.in_(ids)).values(concept_node_id=new_parent)
        )
    await db.execute(delete(ConceptNode).where(ConceptNode.id.in_(ids)))


# ---- 응답 빌더 (저장소3 → TeacherQuestionOut, 저장소2 → StudentQuestionOut) ----


def _week_ref(week: Week) -> WeekRef:
    return WeekRef(id=week.id, week_no=week.week_no, title=week.title)


async def teacher_questions_out(
    db: AsyncSession, course_id: int, rows: Sequence[TeacherQuestion]
) -> list[TeacherQuestionOut]:
    if not rows:
        return []
    weeks = {w.id: w for w in (await db.scalars(select(Week).where(Week.course_id == course_id))).all()}
    nodes = {
        n.id: n
        for n in (await db.scalars(select(ConceptNode).where(ConceptNode.course_id == course_id))).all()
    }
    session_ids = {r.session_id for r in rows}
    sessions = {
        s.id: s
        for s in (await db.scalars(select(ClassSession).where(ClassSession.id.in_(session_ids)))).all()
    }
    out: list[TeacherQuestionOut] = []
    for r in rows:
        session_week = weeks[sessions[r.session_id].week_id]
        out.append(
            TeacherQuestionOut(
                id=r.id,
                session_id=r.session_id,
                session_week_no=session_week.week_no,
                assigned_week=_week_ref(weeks[r.assigned_week_id]),
                concept_path=[PathItem(**p) for p in concept_path(nodes, r.concept_node_id)],
                question_type=QuestionType(r.question_type) if r.question_type else None,
                keyword=r.keyword,
                refined_text=r.refined_text,
                off_week=r.off_week,
                created_at=r.created_at,
                classified_at=r.classified_at,
            )
        )
    return out


async def student_questions_out(
    db: AsyncSession, rows: Sequence[StudentQuestion]
) -> list[StudentQuestionOut]:
    if not rows:
        return []
    course_ids = {r.course_id for r in rows}
    courses = {c.id: c for c in (await db.scalars(select(Course).where(Course.id.in_(course_ids)))).all()}
    weeks = {w.id: w for w in (await db.scalars(select(Week).where(Week.course_id.in_(course_ids)))).all()}
    nodes = {
        n.id: n
        for n in (await db.scalars(select(ConceptNode).where(ConceptNode.course_id.in_(course_ids)))).all()
    }
    out: list[StudentQuestionOut] = []
    for r in rows:
        course = courses[r.course_id]
        assigned = weeks.get(r.assigned_week_id) if r.assigned_week_id is not None else None
        out.append(
            StudentQuestionOut(
                id=r.id,
                course=CourseRef(id=course.id, name=course.name),
                session_week=_week_ref(weeks[r.session_week_id]),
                assigned_week=_week_ref(assigned) if assigned else None,
                concept_path=[PathItem(**p) for p in concept_path(nodes, r.concept_node_id)],
                question_type=QuestionType(r.question_type) if r.question_type else None,
                keyword=r.keyword,
                status=r.status,
                raw_text=r.raw_text,
                refined_text=r.refined_text,
                has_capture=r.capture_path is not None,
                off_week=r.off_week,
                created_at=r.created_at,
            )
        )
    return out
