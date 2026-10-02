from datetime import datetime
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer


def _iso_utc(value: datetime) -> str:
    return value.replace(tzinfo=None).isoformat() + "Z"


UtcDatetime = Annotated[datetime, PlainSerializer(_iso_utc, return_type=str)]


class QuestionType(str, Enum):
    info_seeking = "info_seeking"  # 정보 수집형
    info_expanding = "info_expanding"  # 정보 확장형
    application_expanding = "application_expanding"  # 적용 확장형
    connecting = "connecting"  # 연결형
    reflective = "reflective"  # 반성적·성찰적


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth ----


class SignupIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=200)
    name: str = Field(min_length=1, max_length=100)
    role: Literal["student", "teacher"]


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(ORM):
    id: int
    email: str
    name: str
    role: Literal["student", "teacher"]


class AuthOut(BaseModel):
    token: str
    user: UserOut


# ---- courses / graph ----


class CourseIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str | None = None
    semester: str | None = None


class CoursePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    code: str | None = None
    semester: str | None = None


class CourseOut(ORM):
    id: int
    name: str
    code: str | None
    semester: str | None
    syllabus_filename: str | None
    syllabus_status: Literal["none", "parsing", "done", "failed"]
    syllabus_error: str | None
    created_at: UtcDatetime
    last_session_week_id: int | None = None


class SessionOut(BaseModel):
    id: int
    course_id: int
    course_name: str
    week_id: int
    week_no: int
    week_title: str
    code: str
    status: Literal["open", "closed"]
    opened_at: UtcDatetime
    closed_at: UtcDatetime | None


class CourseSummary(BaseModel):
    id: int
    name: str
    code: str | None
    semester: str | None
    week_count: int
    question_count: int
    open_session: SessionOut | None


class MaterialOut(ORM):
    id: int
    filename: str
    kind: Literal["pdf", "pptx"]
    status: Literal["processing", "done", "failed"]
    error: str | None
    page_count: int


class NodeOut(ORM):
    id: int
    parent_id: int | None
    title: str
    summary: str
    source: Literal["syllabus", "material", "web", "llm", "manual"]
    edited: bool
    position: int
    question_count: int = 0


class WeekOut(BaseModel):
    id: int
    week_no: int
    title: str
    description: str
    is_lecture: bool
    gen_status: Literal["idle", "running", "done", "failed"]
    gen_source: Literal["none", "material", "web", "llm"]
    gen_error: str | None
    materials: list[MaterialOut]
    nodes: list[NodeOut]


class GraphOut(BaseModel):
    course: CourseOut
    weeks: list[WeekOut]
    open_session: SessionOut | None


class WeekIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class WeekPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_lecture: bool | None = None


class NodeIn(BaseModel):
    parent_id: int | None = None
    title: str = Field(min_length=1, max_length=300)
    summary: str | None = None


class NodePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    summary: str | None = None
    parent_id: int | None = None
    week_id: int | None = None


class BannedWordIn(BaseModel):
    word: str


class BannedWordOut(ORM):
    id: int
    word: str


# ---- sessions ----


class SessionCreate(BaseModel):
    week_id: int


class JoinIn(BaseModel):
    code: str


# ---- questions ----


class WeekRef(BaseModel):
    id: int
    week_no: int
    title: str


class CourseRef(BaseModel):
    id: int
    name: str


class PathItem(BaseModel):
    id: int
    title: str


class TeacherQuestionOut(BaseModel):
    """저장소3 응답 — 학생 id/이름/이메일/raw_text 필드 없음."""

    id: int
    session_id: int
    session_week_no: int
    assigned_week: WeekRef
    concept_path: list[PathItem]
    question_type: QuestionType | None
    keyword: str
    refined_text: str
    off_week: bool
    created_at: UtcDatetime
    classified_at: UtcDatetime


class RefineIn(BaseModel):
    session_id: int
    raw_text: str = ""
    image: str | None = None
    previous_refined: str | None = None
    feedback: str | None = None


class RefineOut(BaseModel):
    status: Literal["ok", "blocked"]
    refined_text: str | None = None
    reason: str | None = None


class QuestionCreate(BaseModel):
    session_id: int
    raw_text: str = ""
    image: str | None = None
    refined_text: str = Field(min_length=1, max_length=2000)
    refine_rounds: int = Field(default=0, ge=0)


class StudentQuestionOut(BaseModel):
    id: int
    course: CourseRef
    session_week: WeekRef
    assigned_week: WeekRef | None
    concept_path: list[PathItem]
    question_type: QuestionType | None
    keyword: str | None
    status: Literal["pending", "classified", "failed"]
    raw_text: str
    refined_text: str
    has_capture: bool
    off_week: bool
    created_at: UtcDatetime
