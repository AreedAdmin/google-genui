"""Environment-driven settings (pydantic-settings).

Maps the analysis-service env vars from ``.env.example`` §8 / §4:
  - ANALYSIS_SERVICE_PORT
  - TREE_SITTER_LANGUAGES   (comma-separated)
  - REDIS_URL               (optional; service degrades gracefully if absent)
"""

from __future__ import annotations

from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Service configuration, read from the environment / a local ``.env``."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Port the FastAPI app listens on (informational here; uvicorn is told the
    # port on the command line, but we expose it for tooling / health output).
    analysis_service_port: int = 8000

    # Languages tree-sitter should parse. Comma-separated in the env
    # (``typescript,javascript``). ``NoDecode`` stops pydantic-settings from
    # trying to JSON-parse the raw env string before our validator splits it.
    tree_sitter_languages: Annotated[list[str], NoDecode] = ["typescript", "javascript"]

    # Optional Redis URL. When unset/empty the cache layer is in-memory only.
    redis_url: str | None = None

    # Log verbosity (shared LOG_LEVEL from the root .env).
    log_level: str = "info"

    @field_validator("tree_sitter_languages", mode="before")
    @classmethod
    def _split_languages(cls, value: object) -> object:
        """Accept ``"typescript,javascript"`` as well as a real list."""
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("redis_url", mode="before")
    @classmethod
    def _empty_redis_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


# Single shared instance. Import ``settings`` everywhere.
settings = Settings()
