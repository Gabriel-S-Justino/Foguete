"""Esquemas Pydantic (entrada validada; o estado completo da campanha é guardado como JSON versionado)."""
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

NAME_MAX = 32


class SessionCreate(BaseModel):
    playerName: str = Field(min_length=1, max_length=200)

    @field_validator("playerName")
    @classmethod
    def clean_name(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", v).strip()
        if not v:
            raise ValueError("O nome não pode conter apenas espaços.")
        if len(v) > NAME_MAX:
            raise ValueError(f"Use no máximo {NAME_MAX} caracteres.")
        if re.search(r"[<>{}]", v):
            raise ValueError("Caracteres < > { } não são permitidos.")
        return v


class SessionOut(BaseModel):
    sessionId: str
    token: str
    playerName: str


class InstalledComponent(BaseModel):
    instanceId: str = Field(max_length=80)
    componentId: str = Field(max_length=64)


class Spacecraft(BaseModel):
    installed: list[InstalledComponent] = Field(default_factory=list, max_length=200)
    propellantKg: float = Field(ge=0, le=1_000_000)
    testCampaign: Literal["minimal", "standard", "extensive"] = "standard"


class Derived(BaseModel):
    requiredDvMS: float = Field(ge=0, le=100_000)
    totalDvMS: float = Field(ge=0, le=100_000)
    launchProfile: str = Field(max_length=32)


class CampaignIn(BaseModel):
    """Campos usados pelo servidor; o restante do estado é aceito e guardado como está."""
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    playerName: str = Field(max_length=NAME_MAX)
    missionId: Literal["leo-climate", "lunar-he3", "jupiter-system"] | None = None
    assistance: Literal["iniciante", "intermediario", "avancado"] = "iniciante"
    stage: str = Field(max_length=32)
    spacecraft: Spacecraft
    vehicleId: str | None = Field(default=None, max_length=32)
    plan: dict[str, Any] | None = None
    derived: Derived | None = None
    flightOutcome: str = Field(default="pending", max_length=32)
    attempt: int = Field(default=1, ge=1, le=10_000)
    versions: dict[str, str] = Field(default_factory=dict)
    report: dict[str, Any] | None = None


class FlightEventIn(BaseModel):
    t: float
    phase: str = Field(max_length=32)
    id: str = Field(max_length=80)
    label: str = Field(max_length=2000)
    severity: Literal["info", "aviso", "grave", "critica"]


class EventsIn(BaseModel):
    events: list[FlightEventIn] = Field(max_length=2000)


class ValidationOut(BaseModel):
    approved: bool
    checks: dict[str, str]
    blockers: list[str]
    warnings: list[str]
    computedAt: str
    engineVersion: str
    serverMetrics: dict[str, Any]
