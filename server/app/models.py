from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, utcnow


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(10))  # 'student' | 'teacher'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---- 저장소1: 커리큘럼 그래프 ----


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str | None] = mapped_column(String(50))
    semester: Mapped[str | None] = mapped_column(String(50))
    syllabus_filename: Mapped[str | None] = mapped_column(String)
    syllabus_status: Mapped[str] = mapped_column(String(10), default="none")  # none|parsing|done|failed
    syllabus_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Week(Base):
    __tablename__ = "weeks"
    __table_args__ = (UniqueConstraint("course_id", "week_no"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    week_no: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    is_lecture: Mapped[bool] = mapped_column(Boolean, default=True)
    gen_status: Mapped[str] = mapped_column(String(10), default="idle")  # idle|running|done|failed
    gen_source: Mapped[str] = mapped_column(String(10), default="none")  # none|material|web|llm
    gen_error: Mapped[str | None] = mapped_column(Text)


class ConceptNode(Base):
    __tablename__ = "concept_nodes"
    # AUTOINCREMENT: 재생성으로 삭제된 노드 id가 새 노드에 재사용되지 않도록.
    __table_args__ = {"sqlite_autoincrement": True}
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    week_id: Mapped[int] = mapped_column(ForeignKey("weeks.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("concept_nodes.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(10))  # syllabus|material|web|llm|manual
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)
    embedding_model: Mapped[str | None] = mapped_column(String)


class Material(Base):
    __tablename__ = "materials"
    id: Mapped[int] = mapped_column(primary_key=True)
    week_id: Mapped[int] = mapped_column(ForeignKey("weeks.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String)
    stored_path: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String(10))  # pdf|pptx
    status: Mapped[str] = mapped_column(String(12), default="processing")  # processing|done|failed
    error: Mapped[str | None] = mapped_column(Text)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MaterialChunk(Base):
    __tablename__ = "material_chunks"
    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    week_id: Mapped[int] = mapped_column(ForeignKey("weeks.id", ondelete="CASCADE"), index=True)
    concept_node_id: Mapped[int | None] = mapped_column(
        ForeignKey("concept_nodes.id", ondelete="SET NULL"), index=True
    )
    page_from: Mapped[int] = mapped_column(Integer)
    page_to: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)
    embedding_model: Mapped[str | None] = mapped_column(String)


class BannedWord(Base):
    __tablename__ = "banned_words"
    __table_args__ = (UniqueConstraint("course_id", "word"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    word: Mapped[str] = mapped_column(String(100))


class ClassSession(Base):
    __tablename__ = "class_sessions"
    __table_args__ = (
        Index("uq_open_session_code", "code", unique=True, sqlite_where=text("status = 'open'")),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    week_id: Mapped[int] = mapped_column(ForeignKey("weeks.id"))
    code: Mapped[str] = mapped_column(String(6))
    status: Mapped[str] = mapped_column(String(6), default="open")  # open|closed
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)


# ---- 저장소2: 학생 질문 ----


class StudentQuestion(Base):
    __tablename__ = "student_questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("class_sessions.id"), index=True)
    session_week_id: Mapped[int] = mapped_column(ForeignKey("weeks.id"))
    raw_text: Mapped[str] = mapped_column(Text, default="")
    capture_path: Mapped[str | None] = mapped_column(String)
    refined_text: Mapped[str] = mapped_column(Text)
    refine_rounds: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending|classified|failed
    concept_node_id: Mapped[int | None] = mapped_column(
        ForeignKey("concept_nodes.id", ondelete="SET NULL"), index=True
    )
    assigned_week_id: Mapped[int | None] = mapped_column(ForeignKey("weeks.id", ondelete="SET NULL"))
    question_type: Mapped[str | None] = mapped_column(String(30))
    keyword: Mapped[str | None] = mapped_column(String(100))
    off_week: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    classified_at: Mapped[datetime | None] = mapped_column(DateTime)


# ---- 저장소3: 교사 질문 (학생 식별자 없음) ----


class TeacherQuestion(Base):
    __tablename__ = "teacher_questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_question_id: Mapped[int] = mapped_column(
        ForeignKey("student_questions.id", ondelete="CASCADE"), unique=True
    )
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("class_sessions.id"), index=True)
    assigned_week_id: Mapped[int] = mapped_column(ForeignKey("weeks.id"))
    concept_node_id: Mapped[int | None] = mapped_column(
        ForeignKey("concept_nodes.id", ondelete="SET NULL"), index=True
    )
    question_type: Mapped[str | None] = mapped_column(String(30))
    keyword: Mapped[str] = mapped_column(String(100))
    refined_text: Mapped[str] = mapped_column(Text)
    off_week: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    classified_at: Mapped[datetime] = mapped_column(DateTime)
