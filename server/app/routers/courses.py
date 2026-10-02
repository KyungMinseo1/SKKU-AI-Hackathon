import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.context import AppContext
from app.db import get_db
from app.models import (
    BannedWord,
    ClassSession,
    ConceptNode,
    Course,
    Material,
    StudentQuestion,
    TeacherQuestion,
    User,
    Week,
)
from app.routers.common import (
    open_session_of,
    owned_course,
    owned_material,
    owned_week,
    session_out,
)
from app.schemas import (
    BannedWordIn,
    BannedWordOut,
    CourseIn,
    CourseOut,
    CoursePatch,
    CourseSummary,
    GraphOut,
    MaterialOut,
    NodeIn,
    NodeOut,
    NodePatch,
    TeacherQuestionOut,
    WeekIn,
    WeekOut,
    WeekPatch,
)
from app.security import require_teacher
from app.services.curriculum import (
    generate_week_job,
    parse_syllabus_job,
    process_material_job,
    syllabus_dir,
)
from app.services.graph import delete_subtree, subtree_ids, teacher_questions_out

router = APIRouter(prefix="/api", tags=["courses"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
NODE_NOT_FOUND = "개념을 찾을 수 없습니다"
SAME_WEEK_PARENT = "상위 노드는 같은 주차에 있어야 합니다"


def _ctx(request: Request) -> AppContext:
    return request.app.state.ctx


async def _read_upload(file: UploadFile, bad_type_message: str) -> bytes:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, bad_type_message)
    return data


async def _course_out(db: AsyncSession, course: Course) -> CourseOut:
    last_week_id = await db.scalar(
        select(ClassSession.week_id)
        .where(ClassSession.course_id == course.id)
        .order_by(ClassSession.opened_at.desc(), ClassSession.id.desc())
        .limit(1)
    )
    out = CourseOut.model_validate(course)
    out.last_session_week_id = last_week_id
    return out


async def _course_has_questions(db: AsyncSession, course_id: int) -> bool:
    return (
        await db.scalar(select(StudentQuestion.id).where(StudentQuestion.course_id == course_id).limit(1))
    ) is not None


async def _node_question_counts(db: AsyncSession, course_id: int) -> dict[int, int]:
    rows = await db.execute(
        select(TeacherQuestion.concept_node_id, func.count())
        .where(TeacherQuestion.course_id == course_id, TeacherQuestion.concept_node_id.is_not(None))
        .group_by(TeacherQuestion.concept_node_id)
    )
    return {nid: cnt for nid, cnt in rows.all()}


def _node_out(node: ConceptNode, counts: dict[int, int]) -> NodeOut:
    out = NodeOut.model_validate(node)
    out.question_count = counts.get(node.id, 0)
    return out


async def _week_out(db: AsyncSession, week: Week, counts: dict[int, int] | None = None) -> WeekOut:
    if counts is None:
        counts = await _node_question_counts(db, week.course_id)
    materials = (
        await db.scalars(select(Material).where(Material.week_id == week.id).order_by(Material.id))
    ).all()
    nodes = (
        await db.scalars(
            select(ConceptNode).where(ConceptNode.week_id == week.id).order_by(ConceptNode.position, ConceptNode.id)
        )
    ).all()
    return WeekOut(
        id=week.id,
        week_no=week.week_no,
        title=week.title,
        description=week.description,
        is_lecture=week.is_lecture,
        gen_status=week.gen_status,
        gen_source=week.gen_source,
        gen_error=week.gen_error,
        materials=[MaterialOut.model_validate(m) for m in materials],
        nodes=[_node_out(n, counts) for n in nodes],
    )


async def _owned_node(db: AsyncSession, user: User, node_id: int) -> ConceptNode:
    node = await db.get(ConceptNode, node_id)
    course = await db.get(Course, node.course_id) if node else None
    if node is None or course is None or course.teacher_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NODE_NOT_FOUND)
    return node


async def _next_position(db: AsyncSession, week_id: int, parent_id: int | None) -> int:
    parent_cond = ConceptNode.parent_id.is_(None) if parent_id is None else ConceptNode.parent_id == parent_id
    current = await db.scalar(
        select(func.max(ConceptNode.position)).where(ConceptNode.week_id == week_id, parent_cond)
    )
    return 0 if current is None else current + 1


# ---- courses ----


@router.get("/courses", response_model=list[CourseSummary])
async def list_courses(user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    courses = (
        await db.scalars(select(Course).where(Course.teacher_id == user.id).order_by(Course.created_at.desc()))
    ).all()
    out: list[CourseSummary] = []
    for c in courses:
        week_count = await db.scalar(select(func.count()).select_from(Week).where(Week.course_id == c.id))
        question_count = await db.scalar(
            select(func.count()).select_from(TeacherQuestion).where(TeacherQuestion.course_id == c.id)
        )
        open_session = await open_session_of(db, c.id)
        out.append(
            CourseSummary(
                id=c.id,
                name=c.name,
                code=c.code,
                semester=c.semester,
                week_count=week_count or 0,
                question_count=question_count or 0,
                open_session=await session_out(db, open_session) if open_session else None,
            )
        )
    return out


@router.post("/courses", response_model=CourseOut, status_code=status.HTTP_201_CREATED)
async def create_course(body: CourseIn, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    course = Course(
        teacher_id=user.id,
        name=body.name.strip(),
        code=(body.code or "").strip() or None,
        semester=(body.semester or "").strip() or None,
    )
    db.add(course)
    await db.commit()
    return await _course_out(db, course)


@router.patch("/courses/{course_id}", response_model=CourseOut)
async def patch_course(
    course_id: int, body: CoursePatch, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    course = await owned_course(db, user, course_id)
    fields = body.model_fields_set
    if "name" in fields and body.name is not None:
        course.name = body.name.strip()
    if "code" in fields:
        course.code = (body.code or "").strip() or None
    if "semester" in fields:
        course.semester = (body.semester or "").strip() or None
    await db.commit()
    return await _course_out(db, course)


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(course_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    course = await owned_course(db, user, course_id)
    files = list(
        (
            await db.scalars(
                select(Material.stored_path).join(Week, Material.week_id == Week.id).where(Week.course_id == course_id)
            )
        ).all()
    )
    files += (
        await db.scalars(
            select(StudentQuestion.capture_path).where(
                StudentQuestion.course_id == course_id, StudentQuestion.capture_path.is_not(None)
            )
        )
    ).all()
    # 질문 테이블은 강좌·세션·주차 FK에 CASCADE가 없으므로 먼저 지운다(저장소3 → 저장소2 순).
    await db.execute(delete(TeacherQuestion).where(TeacherQuestion.course_id == course_id))
    await db.execute(delete(StudentQuestion).where(StudentQuestion.course_id == course_id))
    await db.delete(course)
    await db.commit()
    for f in files:
        Path(f).unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/courses/{course_id}/syllabus", response_model=CourseOut, status_code=status.HTTP_202_ACCEPTED)
async def upload_syllabus(
    course_id: int,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    course = await owned_course(db, user, course_id)
    bad = "PDF 파일만 업로드할 수 있습니다"
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, bad)
    if await _course_has_questions(db, course_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "질문이 있는 강의는 실라버스를 다시 올릴 수 없습니다")
    data = await _read_upload(file, bad)
    ctx = _ctx(request)
    folder = syllabus_dir(ctx)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{course_id}_*.pdf"):
        old.unlink(missing_ok=True)
    (folder / f"{course_id}_{uuid.uuid4().hex}.pdf").write_bytes(data)
    course.syllabus_filename = file.filename
    course.syllabus_status = "parsing"
    course.syllabus_error = None
    await db.commit()
    ctx.jobs.spawn(parse_syllabus_job(ctx, course_id))
    return await _course_out(db, course)


@router.get("/courses/{course_id}/graph", response_model=GraphOut)
async def get_graph(course_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    course = await owned_course(db, user, course_id)
    counts = await _node_question_counts(db, course_id)
    weeks = (await db.scalars(select(Week).where(Week.course_id == course_id).order_by(Week.week_no))).all()
    open_session = await open_session_of(db, course_id)
    return GraphOut(
        course=await _course_out(db, course),
        weeks=[await _week_out(db, w, counts) for w in weeks],
        open_session=await session_out(db, open_session) if open_session else None,
    )


@router.get("/courses/{course_id}/questions", response_model=list[TeacherQuestionOut])
async def course_questions(course_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    await owned_course(db, user, course_id)
    rows = (
        await db.scalars(
            select(TeacherQuestion)
            .where(TeacherQuestion.course_id == course_id)
            .order_by(TeacherQuestion.created_at, TeacherQuestion.id)
        )
    ).all()
    return await teacher_questions_out(db, course_id, rows)


# ---- weeks ----


@router.post("/courses/{course_id}/weeks", response_model=WeekOut, status_code=status.HTTP_201_CREATED)
async def create_week(
    course_id: int, body: WeekIn, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    await owned_course(db, user, course_id)
    max_no = await db.scalar(select(func.max(Week.week_no)).where(Week.course_id == course_id))
    week = Week(course_id=course_id, week_no=(max_no or 0) + 1, title=body.title.strip(), is_lecture=True)
    db.add(week)
    await db.commit()
    return await _week_out(db, week)


@router.patch("/weeks/{week_id}", response_model=WeekOut)
async def patch_week(
    week_id: int, body: WeekPatch, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    week, _ = await owned_week(db, user, week_id)
    if body.title is not None and body.title.strip() != week.title:
        week.title = body.title.strip()
        # 노드 임베딩 텍스트에 주차 제목이 들어가므로 무효화
        await db.execute(update(ConceptNode).where(ConceptNode.week_id == week.id).values(embedding=None))
    if body.is_lecture is not None:
        week.is_lecture = body.is_lecture
    await db.commit()
    return await _week_out(db, week)


@router.delete("/weeks/{week_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_week(week_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    week, _ = await owned_week(db, user, week_id)
    referenced = (
        await db.scalar(
            select(StudentQuestion.id)
            .where((StudentQuestion.session_week_id == week_id) | (StudentQuestion.assigned_week_id == week_id))
            .limit(1)
        )
        is not None
        or await db.scalar(select(TeacherQuestion.id).where(TeacherQuestion.assigned_week_id == week_id).limit(1))
        is not None
        or await db.scalar(select(ClassSession.id).where(ClassSession.week_id == week_id).limit(1)) is not None
    )
    if referenced:
        raise HTTPException(status.HTTP_409_CONFLICT, "질문 또는 수업 기록이 있는 주차는 삭제할 수 없습니다")
    files = (await db.scalars(select(Material.stored_path).where(Material.week_id == week_id))).all()
    await db.delete(week)
    await db.commit()
    for f in files:
        Path(f).unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/weeks/{week_id}/regenerate", response_model=WeekOut, status_code=status.HTTP_202_ACCEPTED)
async def regenerate_week(
    week_id: int, request: Request, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    week, _ = await owned_week(db, user, week_id)
    if week.gen_status == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 생성 중입니다")
    week.gen_status = "running"
    week.gen_error = None
    await db.commit()
    ctx = _ctx(request)
    ctx.jobs.spawn(generate_week_job(ctx, week_id))
    return await _week_out(db, week)


# ---- materials ----


@router.post("/weeks/{week_id}/materials", response_model=MaterialOut, status_code=status.HTTP_202_ACCEPTED)
async def upload_material(
    week_id: int,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    week, _ = await owned_week(db, user, week_id)
    bad = "PDF 또는 PPTX 파일만 업로드할 수 있습니다"
    filename = file.filename or ""
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in ("pdf", "pptx"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, bad)
    data = await _read_upload(file, bad)
    ctx = _ctx(request)
    folder = Path(ctx.settings.DATA_DIR) / "uploads" / "materials"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{week_id}_{uuid.uuid4().hex}.{ext}"
    path.write_bytes(data)
    material = Material(week_id=week.id, filename=filename, stored_path=str(path), kind=ext, status="processing")
    db.add(material)
    await db.commit()
    ctx.jobs.spawn(process_material_job(ctx, material.id))
    return MaterialOut.model_validate(material)


@router.delete("/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: int, request: Request, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    material, week = await owned_material(db, user, material_id)
    stored = material.stored_path
    await db.delete(material)  # 청크는 FK CASCADE
    await db.commit()
    Path(stored).unlink(missing_ok=True)
    ctx = _ctx(request)
    ctx.jobs.spawn(generate_week_job(ctx, week.id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- nodes ----


@router.post("/weeks/{week_id}/nodes", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
async def create_node(
    week_id: int, body: NodeIn, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    week, _ = await owned_week(db, user, week_id)
    if body.parent_id is not None:
        parent = await db.get(ConceptNode, body.parent_id)
        if parent is None or parent.week_id != week.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, SAME_WEEK_PARENT)
    node = ConceptNode(
        course_id=week.course_id,
        week_id=week.id,
        parent_id=body.parent_id,
        title=body.title.strip(),
        summary=(body.summary or "").strip(),
        source="manual",
        edited=True,
        position=await _next_position(db, week.id, body.parent_id),
    )
    db.add(node)
    await db.commit()
    return _node_out(node, {})


@router.patch("/nodes/{node_id}", response_model=NodeOut)
async def patch_node(
    node_id: int, body: NodePatch, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    node = await _owned_node(db, user, node_id)
    fields = body.model_fields_set
    course_nodes = (await db.scalars(select(ConceptNode).where(ConceptNode.course_id == node.course_id))).all()
    subtree = subtree_ids(course_nodes, node.id)

    target_week_id = node.week_id
    week_changed = "week_id" in fields and body.week_id is not None and body.week_id != node.week_id
    if week_changed:
        target_week = await db.get(Week, body.week_id)
        if target_week is None or target_week.course_id != node.course_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "주차를 찾을 수 없습니다")
        target_week_id = target_week.id

    moved = False
    if "parent_id" in fields and body.parent_id != node.parent_id:
        if body.parent_id is not None:
            if body.parent_id in subtree:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "자기 하위 노드로 이동할 수 없습니다")
            parent = await db.get(ConceptNode, body.parent_id)
            if parent is None or parent.week_id != target_week_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, SAME_WEEK_PARENT)
        node.parent_id = body.parent_id
        node.position = await _next_position(db, target_week_id, body.parent_id)
        moved = True
    elif week_changed:
        node.parent_id = None
        node.position = await _next_position(db, target_week_id, None)
        moved = True

    if week_changed:
        await db.execute(update(ConceptNode).where(ConceptNode.id.in_(subtree)).values(week_id=target_week_id))
        # 질문의 배정 주차 = 노드의 주차 불변식 유지
        sqs = (await db.scalars(select(StudentQuestion).where(StudentQuestion.concept_node_id.in_(subtree)))).all()
        for sq in sqs:
            sq.assigned_week_id = target_week_id
            sq.off_week = target_week_id != sq.session_week_id
        tqs = (await db.scalars(select(TeacherQuestion).where(TeacherQuestion.concept_node_id.in_(subtree)))).all()
        for tq in tqs:
            tq.assigned_week_id = target_week_id
            tq.off_week = target_week_id != (await db.get(ClassSession, tq.session_id)).week_id

    if moved:
        await db.execute(update(ConceptNode).where(ConceptNode.id.in_(subtree)).values(embedding=None))
    if "title" in fields and body.title is not None:
        node.title = body.title.strip()
    if "summary" in fields:
        node.summary = (body.summary or "").strip()
    node.edited = True
    node.embedding = None
    await db.commit()
    await db.refresh(node)
    return _node_out(node, await _node_question_counts(db, node.course_id))


@router.delete("/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(node_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    node = await _owned_node(db, user, node_id)
    await delete_subtree(db, node)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- banned words ----


@router.get("/courses/{course_id}/banned-words", response_model=list[BannedWordOut])
async def list_banned_words(course_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    await owned_course(db, user, course_id)
    return (await db.scalars(select(BannedWord).where(BannedWord.course_id == course_id).order_by(BannedWord.id))).all()


@router.post("/courses/{course_id}/banned-words", response_model=BannedWordOut, status_code=status.HTTP_201_CREATED)
async def add_banned_word(
    course_id: int, body: BannedWordIn, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)
):
    await owned_course(db, user, course_id)
    word = "".join(body.word.split()).lower()
    if not word:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "금지어를 입력해 주세요")
    if await db.scalar(select(BannedWord.id).where(BannedWord.course_id == course_id, BannedWord.word == word)):
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 등록된 금지어입니다")
    banned = BannedWord(course_id=course_id, word=word)
    db.add(banned)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 등록된 금지어입니다") from None
    return banned


@router.delete("/banned-words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_banned_word(word_id: int, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    banned = await db.get(BannedWord, word_id)
    if banned is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "금지어를 찾을 수 없습니다")
    await owned_course(db, user, banned.course_id)
    await db.delete(banned)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
