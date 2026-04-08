"""Application settings loaded from environment variables."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GEMMA_", case_sensitive=False)

    ollama_url: str = "http://localhost:11434"
    model_name: str = "gemma4"
    backend_port: int = 11435
    request_timeout: float = 60.0


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
