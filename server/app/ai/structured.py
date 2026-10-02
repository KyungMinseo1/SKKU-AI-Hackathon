from pydantic import BaseModel, ConfigDict

from app.schemas import QuestionType


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RefineResult(_Strict):
    appropriate: bool
    block_reason: str
    refined_question: str


class SyllabusWeek(_Strict):
    week_no: int
    title: str
    topics: list[str]
    is_lecture: bool
    description: str


class SyllabusParse(_Strict):
    weeks: list[SyllabusWeek]


class GenConcept(_Strict):
    title: str
    summary: str
    chunk_ids: list[int]


class GenTopic(_Strict):
    existing_topic_id: int | None
    title: str
    summary: str
    concepts: list[GenConcept]


class WeekConcepts(_Strict):
    topics: list[GenTopic]


class ClassifyResult(_Strict):
    concept_node_id: int | None
    question_type: QuestionType
    keyword: str
