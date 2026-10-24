"""Conexão com o banco. Em produção usa PostgreSQL (Neon); localmente, PostgreSQL via Docker Compose.

O Neon exige TLS: a URL deve conter sslmode=require (o Neon já fornece assim). Em ambiente serverless
(Vercel) o pool é pequeno e as conexões são verificadas antes do uso (pool_pre_ping), pois o Neon encerra
conexões ociosas. Para muitas instâncias simultâneas, prefira a URL "pooled" do Neon (PgBouncer).
"""
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


def normalize_url(url: str) -> str:
    """Aceita postgres:// e postgresql:// (formato do Neon) e usa o driver psycopg 3."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        s = get_settings()
        url = normalize_url(s.database_url)
        if url.startswith("sqlite"):
            _engine = create_engine(url, connect_args={"check_same_thread": False})
        else:
            _engine = create_engine(
                url,
                pool_size=s.db_pool_size,
                max_overflow=s.db_max_overflow,
                pool_recycle=s.db_pool_recycle_s,
                pool_pre_ping=True,
            )
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    """Usado nos testes para trocar o banco."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None


def get_db() -> Iterator[Session]:
    get_engine()
    assert _SessionLocal is not None
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()
