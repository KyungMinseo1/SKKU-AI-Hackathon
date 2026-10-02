import hashlib
import re
from pathlib import Path

import httpx
import numpy as np
import pytest
from httpx import ASGITransport

from app.ai.llm import AIClients
from app.ai.structured import (
    ClassifyResult,
    GenConcept,
    GenTopic,
    RefineResult,
    SyllabusParse,
    SyllabusWeek,
    WeekConcepts,
)
from app.config import get_settings
from app.schemas import QuestionType

DEMO_PDF = Path(__file__).resolve().parents[2] / "docs/인공지능개론/노해선_인공지능개론01_강의계획서_16주차.pdf"


def _text_of(content) -> str:
    if isinstance(content, list):
        return "\n".join(p.get("text", "") for p in content if p.get("type") == "text")
    return content


class FakeChat:
    def __init__(self) -> None:
        self.calls = 0
        self.week_calls = 0
        self.model = "fake"

    async def json(self, system, content, schema):
        self.calls += 1
        text = _text_of(content)
        if schema is RefineResult:
            if "점심" in text:
                return RefineResult(appropriate=False, block_reason="수업과 관련 없는 내용이에요.", refined_question="")
            m = re.search(r"^학생 입력: (.*)$", text, re.MULTILINE)
            raw = m.group(1) if m else text
            return RefineResult(appropriate=True, block_reason="", refined_question=f"{raw}에 대해 설명해 주실 수 있나요?")
        if schema is SyllabusParse:
            return SyllabusParse(
                weeks=[
                    SyllabusWeek(
                        week_no=3,
                        title="지도학습",
                        topics=["머신러닝의 유형(1) 지도학습", "지도학습의 대표적 문제: 회귀와 분류"],
                        is_lecture=True,
                        description="실습: Orange3를 활용한 머신러닝",
                    ),
                    SyllabusWeek(week_no=9, title="중간고사", topics=[], is_lecture=False, description=""),
                ]
            )
        if schema is WeekConcepts:
            self.week_calls += 1
            n = self.week_calls
            m = re.search(r"\[topic:(\d+)\]", text)
            return WeekConcepts(
                topics=[
                    GenTopic(
                        existing_topic_id=int(m.group(1)) if m else None,
                        title=f"생성 주제 {n}",
                        summary="생성된 주제 요약",
                        concepts=[
                            GenConcept(title=f"생성 개념 {n}-1", summary="개념 요약", chunk_ids=[]),
                            GenConcept(title=f"생성 개념 {n}-2", summary="개념 요약", chunk_ids=[]),
                        ],
                    )
                ]
            )
        if schema is ClassifyResult:
            ids = [int(x) for x in re.findall(r"\[(\d+)\]", text)]
            return ClassifyResult(
                concept_node_id=max(ids) if ids else None,
                question_type=QuestionType.info_seeking,
                keyword="회귀",
            )
        raise AssertionError(f"unexpected schema {schema}")

    async def research(self, prompt, query):
        return "지도학습은 정답(레이블)이 있는 데이터로 모델을 학습시키는 방법이다. 회귀와 분류가 대표적이다."


class FakeEmbedder:
    model = "fake-embed"

    async def embed(self, texts):
        out = []
        for t in texts:
            seed = int.from_bytes(hashlib.sha256(t.encode("utf-8")).digest()[:8], "little")
            v = np.random.default_rng(seed).standard_normal(32).astype(np.float32)
            out.append(v / np.linalg.norm(v))
        return out


@pytest.fixture
async def client(tmp_path, monkeypatch):
    env = {
        "DATA_DIR": str(tmp_path),
        "QUESTION_LLM_PROVIDER": "openai",
        "CURRICULUM_LLM_PROVIDER": "openai",
        "QUESTION_LLM_MODEL": "fake",
        "CURRICULUM_LLM_MODEL": "fake",
        "EMBEDDING_PROVIDER": "none",
        "OPENAI_API_KEY": "test",
    }
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    from app.main import app

    async with app.router.lifespan_context(app):
        ctx = app.state.ctx
        question, curriculum = FakeChat(), FakeChat()
        ctx.ai = AIClients(question, curriculum, FakeEmbedder())
        async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            c.ctx = ctx
            c.fake_question = question
            c.fake_curriculum = curriculum
            yield c
    get_settings.cache_clear()


class Api:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.c = client

    async def drain(self) -> None:
        await self.c.ctx.jobs.drain()

    async def signup(self, role: str, email: str) -> dict:
        r = await self.c.post(
            "/api/auth/signup", json={"email": email, "password": "password123", "name": role, "role": role}
        )
        assert r.status_code == 201, r.text
        return {"Authorization": f"Bearer {r.json()['token']}"}

    async def course_with_syllabus(self, teacher: dict) -> int:
        r = await self.c.post("/api/courses", json={"name": "인공지능개론"}, headers=teacher)
        assert r.status_code == 201, r.text
        course_id = r.json()["id"]
        with DEMO_PDF.open("rb") as f:
            r = await self.c.post(
                f"/api/courses/{course_id}/syllabus",
                files={"file": (DEMO_PDF.name, f, "application/pdf")},
                headers=teacher,
            )
        assert r.status_code == 202, r.text
        await self.drain()
        return course_id

    async def graph(self, teacher: dict, course_id: int) -> dict:
        r = await self.c.get(f"/api/courses/{course_id}/graph", headers=teacher)
        assert r.status_code == 200, r.text
        return r.json()

    async def open_session(self, teacher: dict, course_id: int, week_id: int) -> dict:
        r = await self.c.post(f"/api/courses/{course_id}/sessions", json={"week_id": week_id}, headers=teacher)
        assert r.status_code == 201, r.text
        return r.json()

    async def refine(self, student: dict, session_id: int, raw_text: str) -> dict:
        r = await self.c.post(
            "/api/questions/refine", json={"session_id": session_id, "raw_text": raw_text}, headers=student
        )
        assert r.status_code == 200, r.text
        return r.json()

    async def submit(self, student: dict, session_id: int, raw_text: str, refined_text: str):
        return await self.c.post(
            "/api/questions",
            json={"session_id": session_id, "raw_text": raw_text, "refined_text": refined_text, "refine_rounds": 0},
            headers=student,
        )


@pytest.fixture
def api(client) -> Api:
    return Api(client)
