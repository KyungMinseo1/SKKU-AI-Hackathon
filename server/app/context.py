from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.llm import AIClients
from app.config import Settings
from app.services.jobs import JobRunner
from app.services.live_hub import LiveHub


@dataclass
class AppContext:
    settings: Settings
    sessionmaker: async_sessionmaker[AsyncSession]
    ai: AIClients
    hub: LiveHub
    jobs: JobRunner
