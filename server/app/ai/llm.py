import asyncio
import json as jsonlib
import logging
import re
from dataclasses import dataclass
from typing import TypeVar

import numpy as np
import openai
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import Settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*|\s*```\s*$")


def _strip_fences(text: str) -> str:
    return _FENCE_RE.sub("", text.strip())


def _make_client(provider: str, base_url: str, api_key: str) -> AsyncOpenAI:
    if provider == "gemini" and not base_url:
        base_url = GEMINI_OPENAI_BASE_URL
    return AsyncOpenAI(api_key=api_key or "EMPTY", base_url=base_url or None)


class ChatModel:
    def __init__(
        self, provider: str, model: str, base_url: str, api_key: str, reasoning_effort: str
    ) -> None:
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.reasoning_effort = reasoning_effort
        self.client = _make_client(provider, base_url, api_key)
        # 제공자가 json_schema response_format을 거부하면 json_object 모드로 전환(PLAN contingency).
        self._json_object_mode = False

    def _extra(self) -> dict:
        return {"reasoning_effort": self.reasoning_effort} if self.reasoning_effort else {}

    async def json(self, system: str, content: str | list[dict], schema: type[T]) -> T:
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                return await self._json_once(system, content, schema)
            except Exception as e:  # noqa: BLE001 - retried once, then re-raised
                last_error = e
                log.warning("LLM json call failed (attempt %d, %s): %s", attempt + 1, schema.__name__, e)
        assert last_error is not None
        raise last_error

    async def _json_once(self, system: str, content: str | list[dict], schema: type[T]) -> T:
        if not self._json_object_mode:
            messages = [{"role": "system", "content": system}, {"role": "user", "content": content}]
            try:
                resp = await self.client.chat.completions.parse(
                    model=self.model, messages=messages, response_format=schema, **self._extra()
                )
            except openai.BadRequestError as e:
                if "response_format" not in str(e) and "json_schema" not in str(e):
                    raise
                log.warning("provider rejected json_schema response_format; using json_object mode")
                self._json_object_mode = True
            else:
                message = resp.choices[0].message
                if message.parsed is not None:
                    return message.parsed
                return schema.model_validate_json(_strip_fences(message.content or ""))

        schema_json = jsonlib.dumps(schema.model_json_schema(), ensure_ascii=False)
        system_with_schema = (
            f"{system}\n\n반드시 다음 JSON 스키마를 따르는 JSON 객체 하나만 출력하세요:\n{schema_json}"
        )
        messages = [
            {"role": "system", "content": system_with_schema},
            {"role": "user", "content": content},
        ]
        resp = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            response_format={"type": "json_object"},
            **self._extra(),
        )
        return schema.model_validate_json(_strip_fences(resp.choices[0].message.content or ""))

    async def research(self, prompt: str, query: str) -> str | None:
        try:
            if self.provider == "openai":
                resp = await self.client.responses.create(
                    model=self.model, tools=[{"type": "web_search"}], input=prompt
                )
                return resp.output_text or None
            if self.provider == "gemini":
                from google import genai
                from google.genai import types

                client = genai.Client(api_key=self.api_key)
                resp = await client.aio.models.generate_content(
                    model=self.model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[types.Tool(google_search=types.GoogleSearch())]
                    ),
                )
                return resp.text or None
            from ddgs import DDGS

            results = await asyncio.to_thread(
                lambda: DDGS().text(query, region="kr-kr", max_results=6)
            )
            lines = [f"- {r.get('title', '')}: {r.get('body', '')} ({r.get('href', '')})" for r in results or []]
            return "\n".join(lines) or None
        except Exception:
            log.exception("web research failed (%s)", self.provider)
            return None


class Embedder:
    BATCH = 64

    def __init__(self, provider: str, model: str, base_url: str, api_key: str) -> None:
        self.provider = provider
        self.model = model
        self.client = _make_client(provider, base_url, api_key)

    async def embed(self, texts: list[str]) -> list[np.ndarray]:
        out: list[np.ndarray] = []
        for i in range(0, len(texts), self.BATCH):
            batch = texts[i : i + self.BATCH]
            resp = await self.client.embeddings.create(model=self.model, input=batch)
            for item in sorted(resp.data, key=lambda d: d.index):
                vec = np.asarray(item.embedding, dtype=np.float32)
                norm = float(np.linalg.norm(vec))
                out.append(vec / norm if norm > 0 else vec)
        return out


@dataclass
class AIClients:
    question: ChatModel
    curriculum: ChatModel
    embedder: Embedder | None


def _default_key(settings: Settings, provider: str) -> str:
    if provider == "openai":
        return settings.OPENAI_API_KEY
    if provider == "gemini":
        return settings.GEMINI_API_KEY
    return "EMPTY"


def _chat_model(settings: Settings, role: str) -> ChatModel:
    provider = getattr(settings, f"{role}_LLM_PROVIDER")
    base_url = getattr(settings, f"{role}_LLM_BASE_URL")
    if provider == "vllm" and not base_url:
        raise ValueError(f"{role}_LLM_BASE_URL is required when {role}_LLM_PROVIDER=vllm")
    return ChatModel(
        provider=provider,
        model=getattr(settings, f"{role}_LLM_MODEL"),
        base_url=base_url,
        api_key=getattr(settings, f"{role}_LLM_API_KEY") or _default_key(settings, provider),
        reasoning_effort=getattr(settings, f"{role}_LLM_REASONING_EFFORT"),
    )


def build_ai_clients(settings: Settings) -> AIClients:
    embedder: Embedder | None = None
    provider = settings.EMBEDDING_PROVIDER
    if provider != "none":
        if provider == "vllm" and not settings.EMBEDDING_BASE_URL:
            raise ValueError("EMBEDDING_BASE_URL is required when EMBEDDING_PROVIDER=vllm")
        embedder = Embedder(
            provider=provider,
            model=settings.EMBEDDING_MODEL,
            base_url=settings.EMBEDDING_BASE_URL,
            api_key=settings.EMBEDDING_API_KEY or _default_key(settings, provider),
        )
    return AIClients(
        question=_chat_model(settings, "QUESTION"),
        curriculum=_chat_model(settings, "CURRICULUM"),
        embedder=embedder,
    )
