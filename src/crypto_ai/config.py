"""Configuration management using pydantic-settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "Gorm AI"
    debug: bool = False

    # Database
    database_url: str = "postgresql+asyncpg://gorm:gorm@localhost:5433/crypto_ai"
    database_echo: bool = False

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Celery
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # API
    api_v1_prefix: str = "/api/v1"

    # Fine-tuned model
    finetuned_model_path: str = "models/timesfm_finetuned"

    # HuggingFace Hub
    hf_token: str | None = None
    hf_hub_cache: str | None = None

    # Anthropic / Claude
    claude_api: str | None = None

    # Frontend
    frontend_url: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
