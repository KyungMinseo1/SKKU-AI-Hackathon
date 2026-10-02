from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

LLMProvider = Literal["openai", "gemini", "vllm"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATA_DIR: str = "./data"
    JWT_SECRET: str = "dev-secret-change-me"
    JWT_EXPIRE_DAYS: int = 7

    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""

    QUESTION_LLM_PROVIDER: LLMProvider = "openai"
    QUESTION_LLM_MODEL: str = ""
    QUESTION_LLM_BASE_URL: str = ""
    QUESTION_LLM_API_KEY: str = ""
    QUESTION_LLM_REASONING_EFFORT: str = ""
    QUESTION_LLM_SUPPORTS_IMAGES: bool = True

    CURRICULUM_LLM_PROVIDER: LLMProvider = "openai"
    CURRICULUM_LLM_MODEL: str = ""
    CURRICULUM_LLM_BASE_URL: str = ""
    CURRICULUM_LLM_API_KEY: str = ""
    CURRICULUM_LLM_REASONING_EFFORT: str = ""

    EMBEDDING_PROVIDER: Literal["openai", "gemini", "vllm", "none"] = "none"
    EMBEDDING_MODEL: str = ""
    EMBEDDING_BASE_URL: str = ""
    EMBEDDING_API_KEY: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
