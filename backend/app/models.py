"""Modelo relacional: sessões de jogador, campanhas (com revisão), eventos de voo e relatórios finais."""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PlayerSession(Base):
    __tablename__ = "player_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    player_name: Mapped[str] = mapped_column(String(32))
    # Apenas o hash SHA-256 do token é armazenado
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    campaigns: Mapped[list["Campaign"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("player_sessions.id", ondelete="CASCADE"), index=True)
    mission_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    stage: Mapped[str] = mapped_column(String(32))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[dict] = mapped_column(JSON)
    catalog_versions: Mapped[dict] = mapped_column(JSON, default=dict)
    server_approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    session: Mapped[PlayerSession] = relationship(back_populates="campaigns")
    events: Mapped[list["FlightEvent"]] = relationship(back_populates="campaign", cascade="all, delete-orphan")


class FlightEvent(Base):
    __tablename__ = "flight_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    attempt: Mapped[int] = mapped_column(Integer)
    t: Mapped[float] = mapped_column(Float)
    phase: Mapped[str] = mapped_column(String(32))
    event_id: Mapped[str] = mapped_column(String(80))
    label: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    campaign: Mapped[Campaign] = relationship(back_populates="events")


class MissionReport(Base):
    __tablename__ = "mission_reports"
    __table_args__ = (UniqueConstraint("campaign_id", "attempt", name="uq_report_attempt"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("player_sessions.id", ondelete="CASCADE"), index=True)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    attempt: Mapped[int] = mapped_column(Integer)
    mission_id: Mapped[str] = mapped_column(String(32))
    classification: Mapped[str] = mapped_column(String(16))
    science_score: Mapped[float] = mapped_column(Float)
    final_score: Mapped[float] = mapped_column(Float)
    final_cost_usd: Mapped[float] = mapped_column(Float)
    server_approved: Mapped[bool] = mapped_column(Boolean)
    server_blockers: Mapped[list] = mapped_column(JSON, default=list)
    report: Mapped[dict] = mapped_column(JSON)
    catalog_versions: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
