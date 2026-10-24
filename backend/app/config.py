"""Configuração por variáveis de ambiente. Nenhum segredo fica no código."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./sma-dev.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    data_dir: Path = REPO_ROOT / "data"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_recycle_s: int = 300
    session_ttl_days: int = 30
    environment: str = "development"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
