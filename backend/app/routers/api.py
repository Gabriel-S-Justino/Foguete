"""Rotas versionadas /api/v1."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import __version__
from ..catalog import catalog
from ..db import get_db
from ..models import Campaign, FlightEvent, MissionReport, PlayerSession
from ..rules import RuleInputError, ServerValidation, validate
from ..schemas import CampaignIn, EventsIn, SessionCreate, SessionOut, ValidationOut
from ..security import current_session, hash_token, new_token

router = APIRouter(prefix="/api/v1")
ENGINE_VERSION = "sma-server-rules-1.0.0"
CLASSIFICATIONS = {"sucesso", "parcial", "limitada", "abortada", "fracassada"}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # noqa: BLE001 - o health check informa a falha sem expor detalhes
        database = "indisponivel"
    return {"status": "ok", "database": database, "version": __version__, "catalogs": catalog()["versions"]}


@router.post("/sessions", response_model=SessionOut, status_code=201)
def create_session(body: SessionCreate, db: Session = Depends(get_db)):
    token = new_token()
    s = PlayerSession(id=str(uuid.uuid4()), player_name=body.playerName, token_hash=hash_token(token))
    db.add(s)
    db.commit()
    return SessionOut(sessionId=s.id, token=token, playerName=s.player_name)


def _owned(db: Session, session: PlayerSession, campaign_id: str) -> Campaign:
    c = db.get(Campaign, campaign_id)
    if c is None or c.session_id != session.id:
        raise HTTPException(status_code=404, detail="Campanha não encontrada.")
    return c


def _server_validate(body: CampaignIn) -> ServerValidation:
    if not body.missionId:
        raise HTTPException(status_code=422, detail="Campanha sem missão selecionada.")
    try:
        return validate(body.missionId, body.spacecraft.model_dump(), body.vehicleId, body.assistance, body.plan,
                        body.derived.model_dump() if body.derived else None)
    except RuleInputError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.put("/campaigns/{campaign_id}")
def save_campaign(campaign_id: str, body: CampaignIn, session: PlayerSession = Depends(current_session), db: Session = Depends(get_db)):
    if body.id != campaign_id:
        raise HTTPException(status_code=422, detail="Identificador divergente.")
    state = body.model_dump(mode="json")
    c = db.get(Campaign, campaign_id)
    if c is None:
        c = Campaign(id=campaign_id, session_id=session.id, stage=body.stage, state=state, mission_id=body.missionId,
                     attempt=body.attempt, catalog_versions=body.versions, revision=1)
        db.add(c)
    else:
        if c.session_id != session.id:
            raise HTTPException(status_code=404, detail="Campanha não encontrada.")
        c.state, c.stage, c.mission_id, c.attempt, c.catalog_versions = state, body.stage, body.missionId, body.attempt, body.versions
        c.revision += 1
    db.commit()
    return {"id": c.id, "revision": c.revision}


@router.get("/campaigns")
def list_campaigns(session: PlayerSession = Depends(current_session), db: Session = Depends(get_db)):
    rows = db.query(Campaign).filter(Campaign.session_id == session.id).order_by(Campaign.updated_at.desc()).limit(50).all()
    return {"campaigns": [{"id": c.id, "missionId": c.mission_id, "stage": c.stage, "attempt": c.attempt, "updatedAt": c.updated_at.isoformat()} for c in rows]}


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: str, session: PlayerSession = Depends(current_session), db: Session = Depends(get_db)):
    return {"campaign": _owned(db, session, campaign_id).state}


@router.post("/campaigns/{campaign_id}/validate", response_model=ValidationOut)
def validate_campaign(campaign_id: str, body: CampaignIn, session: PlayerSession = Depends(current_session), db: Session = Depends(get_db)):
    if body.id != campaign_id:
        raise HTTPException(status_code=422, detail="Identificador divergente.")
    r = _server_validate(body)
    c = db.get(Campaign, campaign_id)
    if c is not None and c.session_id == session.id:
        c.server_approved = r.approved
        db.commit()
    return ValidationOut(
        approved=r.approved, checks=r.checks, blockers=r.blockers, warnings=[k for k, v in r.checks.items() if v == "aviso"],
        computedAt=datetime.now(timezone.utc).isoformat(), engineVersion=ENGINE_VERSION,
        serverMetrics={"wetMassKg": r.wet_mass_kg, "committedUSD": r.committed_usd, "deltaVAvailableMS": r.delta_v_available_ms, "launchProfile": r.launch_profile, "notes": r.notes},
    )


@router.post("/campaigns/{campaign_id}/events")
def record_events(campaign_id: str, body: EventsIn, session: PlayerSession = Depends(current_session), db: Session = Depends(get_db)):
    c = _owned(db, session, campaign_id)
    for e in body.events:
        db.add(FlightEvent(campaign_id=c.id, attempt=c.attempt, t=e.t, phase=e.phase, event_id=e.id, label=e.label, severity=e.severity))
    db.commit()
    return {"stored": len(body.events)}


@router.post("/campaigns/{campaign_id}/finalize")
def finalize(campaign_id: str, body: CampaignIn, session: PlayerSession = Depends(current_session), db: Session = Depends(get_db)):
    """Recalcula as regras críticas antes de aceitar o resultado. Uma configuração que o servidor reprova
    não pode ter sido lançada: o relatório é registrado como 'fracassada' com os bloqueios encontrados."""
    if body.id != campaign_id:
        raise HTTPException(status_code=422, detail="Identificador divergente.")
    if not body.report:
        raise HTTPException(status_code=422, detail="Relatório ausente.")
    c = db.get(Campaign, campaign_id)
    if c is None:
        save_campaign(campaign_id, body, session, db)
        c = db.get(Campaign, campaign_id)
    elif c.session_id != session.id:
        raise HTTPException(status_code=404, detail="Campanha não encontrada.")
    assert c is not None
    r = _server_validate(body)
    report = dict(body.report)
    launched = body.flightOutcome not in ("pending", "pad-abort")
    if report.get("classification") not in CLASSIFICATIONS:
        raise HTTPException(status_code=422, detail="Classificação inválida.")
    for k in ("scienceScore", "finalScore"):
        v = report.get(k)
        if not isinstance(v, (int, float)) or not 0 <= v <= 100:
            raise HTTPException(status_code=422, detail=f"{k} fora do intervalo 0–100.")
    if launched and not r.approved:
        report["classification"] = "fracassada"
        report["classificationLabel"] = "Resultado rejeitado pelo servidor: configuração não aprovada"
        report["scienceScore"] = 0
        report["finalScore"] = 0
        report.setdefault("recommendations", []).insert(0, f"O servidor reprovou: {', '.join(r.blockers)}.")
    report["finalCostUSD"] = r.committed_usd / (1 + catalog()["missions"][body.missionId]["budget"]["contingencyPct"] / 100) if body.missionId else report.get("finalCostUSD", 0)
    existing = db.query(MissionReport).filter(MissionReport.campaign_id == c.id, MissionReport.attempt == body.attempt).one_or_none()
    row = existing or MissionReport(session_id=session.id, campaign_id=c.id, attempt=body.attempt)
    row.mission_id = body.missionId or ""
    row.classification = report["classification"]
    row.science_score = float(report["scienceScore"])
    row.final_score = float(report["finalScore"])
    row.final_cost_usd = float(report["finalCostUSD"])
    row.server_approved = r.approved
    row.server_blockers = r.blockers
    row.report = report
    row.catalog_versions = body.versions
    if existing is None:
        db.add(row)
    c.state = {**body.model_dump(mode="json"), "report": report}
    c.server_approved = r.approved
    db.commit()
    return {"report": report, "serverChecks": {"approved": r.approved, "blockers": r.blockers}}


@router.get("/reports")
def list_reports(session: PlayerSession = Depends(current_session), db: Session = Depends(get_db)):
    rows = db.query(MissionReport).filter(MissionReport.session_id == session.id).order_by(MissionReport.created_at.desc()).limit(50).all()
    return {"reports": [{**r.report, "attempt": r.attempt} for r in rows]}
