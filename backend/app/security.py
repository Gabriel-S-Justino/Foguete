"""Autenticação leve por sessão: token aleatório entregue ao cliente; apenas o hash fica no banco."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import PlayerSession


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_session(x_session_token: str | None = Header(default=None), db: Session = Depends(get_db)) -> PlayerSession:
    if not x_session_token:
        raise HTTPException(status_code=401, detail="Sessão ausente.")
    s = db.query(PlayerSession).filter(PlayerSession.token_hash == hash_token(x_session_token)).one_or_none()
    if s is None:
        raise HTTPException(status_code=401, detail="Sessão inválida.")
    last = s.last_seen_at if s.last_seen_at.tzinfo else s.last_seen_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - last > timedelta(days=get_settings().session_ttl_days):
        raise HTTPException(status_code=401, detail="Sessão expirada.")
    s.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return s
