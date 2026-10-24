"""Regras críticas reimplementadas no servidor (espelho de frontend/src/engine/rules/validation.ts).

O servidor não confia no resultado do cliente: recalcula orçamento, massa × capacidade documentada,
limite estrutural, tanque, Δv disponível (Tsiolkovsky) e requisitos obrigatórios a partir dos catálogos
em /data. Os mesmos ids e status são exigidos pelos vetores compartilhados em data/test-vectors.

Limitação conhecida: o Δv NECESSÁRIO depende do modelo orbital completo (atmosfera, cônicas ajustadas,
janela de Júpiter), que roda no cliente. O servidor recebe esse valor em `derived` e o registra; a
verificação de Δv usa o Δv disponível calculado aqui.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .catalog import catalog

SERVER_CHECK_PREFIXES = (
    "budget-total", "vehicle-selected", "vehicle-capacity", "structure-limit", "propellant-tank", "delta-v", "mission-", "dep-",
)


@dataclass
class ServerValidation:
    approved: bool
    checks: dict[str, str]
    blockers: list[str]
    dry_mass_kg: float
    wet_mass_kg: float
    component_cost_usd: float
    committed_usd: float
    delta_v_available_ms: float
    launch_profile: str
    notes: list[str] = field(default_factory=list)


class RuleInputError(ValueError):
    pass


def _parts(spacecraft: dict[str, Any]) -> list[dict[str, Any]]:
    comps = catalog()["components"]
    parts = []
    for inst in spacecraft.get("installed", []):
        cid = inst.get("componentId")
        if cid not in comps:
            raise RuleInputError(f"Componente desconhecido: {cid}")
        parts.append(comps[cid])
    return parts


def effective_capabilities(parts: list[dict[str, Any]], mission: dict[str, Any]) -> set[str]:
    caps: set[str] = set()
    for p in parts:
        caps.update(p.get("provides", []))
    env = mission["environment"]
    if "momentum-dump-thrusters" in caps or ("momentum-dump-magnetic" in caps and env["magneticMomentumDumping"]):
        caps.add("momentum-dump")
    if "navigation-gnss" in caps and not env["gnssAvailable"]:
        caps.discard("navigation-gnss")
    return caps


def launch_profile_for(mission: dict[str, Any], plan: dict[str, Any] | None) -> str:
    if plan and plan.get("kind") == "interplanetary":
        for opt in mission["planning"].get("trajectoryOptions", []):
            if opt["id"] == plan.get("trajectory"):
                return opt["launchProfile"]
        return mission["planning"]["trajectoryOptions"][0]["launchProfile"]
    return mission["launchProfile"]


def tsiolkovsky(isp_s: float, m0: float, mf: float) -> float:
    return isp_s * catalog()["g0"] * math.log(m0 / mf)


def validate(
    mission_id: str,
    spacecraft: dict[str, Any],
    vehicle_id: str | None,
    assistance: str,
    plan: dict[str, Any] | None,
    derived: dict[str, Any] | None,
) -> ServerValidation:
    cat = catalog()
    if mission_id not in cat["missions"]:
        raise RuleInputError(f"Missão desconhecida: {mission_id}")
    if assistance not in cat["assistance"]:
        raise RuleInputError(f"Nível de assistência inválido: {assistance}")
    test_campaign = spacecraft.get("testCampaign", "standard")
    if test_campaign not in cat["test_campaigns"]:
        raise RuleInputError(f"Campanha de testes inválida: {test_campaign}")
    mission = cat["missions"][mission_id]
    vehicle = cat["vehicles"].get(vehicle_id) if vehicle_id else None
    if vehicle_id and vehicle is None:
        raise RuleInputError(f"Veículo desconhecido: {vehicle_id}")

    parts = _parts(spacecraft)
    caps = effective_capabilities(parts, mission)
    checks: dict[str, str] = {}
    notes: list[str] = []

    # Massa e propulsão (mesma ordem de soma do motor TypeScript)
    dry = 0.0
    for p in parts:
        dry += p["massKg"]
    tank = 0.0
    for p in parts:
        tank += p["effects"].get("tankCapacityKg", 0) or 0
    loaded = float(spacecraft.get("propellantKg", 0))
    if loaded < 0:
        raise RuleInputError("Propelente negativo")
    prop = min(loaded, tank)
    wet = dry + prop
    structural = next((p["effects"]["maxTotalMassKg"] for p in parts if p["effects"].get("maxTotalMassKg") is not None), None)
    engines = sorted((p for p in parts if p["effects"].get("propulsion")), key=lambda p: -p["effects"]["propulsion"]["thrustN"])
    dv_avail = tsiolkovsky(engines[0]["effects"]["propulsion"]["ispS"], wet, dry) if engines and prop > 0 else 0.0

    # Orçamento: reserva calculada uma única vez
    components_usd = 0.0
    for p in parts:
        components_usd += p["costUSD"]
    available = mission["budget"]["availableUSD"]
    launch_usd = vehicle["cost"]["usedUSD"] if vehicle else 0
    tests_usd = components_usd * cat["test_campaigns"][test_campaign]["costFactor"]
    configuration = components_usd + launch_usd + mission["budget"]["operationsCostUSD"] + tests_usd
    committed = configuration + configuration * (mission["budget"]["contingencyPct"] / 100)
    balance = available - committed
    checks["budget-total"] = ("aviso" if balance < available * 0.03 else "aprovada") if balance >= 0 else "reprovada"

    profile_id = launch_profile_for(mission, plan)
    if vehicle is None:
        checks["vehicle-selected"] = "reprovada"
    else:
        cap = vehicle["capacities"].get(profile_id)
        if not cap or cap["status"] == "pendente" or cap["massKg"] is None:
            checks["vehicle-capacity"] = "reprovada"
        else:
            margin = cat["assistance"][assistance]["payloadMarginPct"]
            allowed = cap["massKg"] * (1 - margin / 100)
            checks["vehicle-capacity"] = "aprovada" if wet <= allowed else "aviso" if wet <= cap["massKg"] else "reprovada"

    checks["structure-limit"] = ("aprovada" if wet <= structural else "reprovada") if structural is not None else "reprovada"
    checks["propellant-tank"] = "aprovada" if loaded <= tank else "reprovada"

    required = float((derived or {}).get("requiredDvMS", 0) or 0)
    total = float((derived or {}).get("totalDvMS", 0) or 0)
    if required <= 0:
        notes.append("Δv necessário não informado pelo cliente: verificação de Δv considera apenas a existência de propulsão.")
        checks["delta-v"] = "aprovada" if dv_avail > 0 else "reprovada"
    else:
        checks["delta-v"] = "aprovada" if dv_avail >= required else "aviso" if dv_avail >= total else "reprovada"

    for req in mission["requirements"]:
        ok = any(c in caps for c in req["anyOf"])
        checks[f"mission-{req['id']}"] = "aprovada" if ok else "reprovada" if req["severity"] == "obrigatoria" else "aviso"
    for p in parts:
        for r in p.get("requires", []):
            if any(c in caps for c in r["anyOf"]):
                continue
            soft = "attitude-fine-reference" in r["anyOf"]
            checks[f"dep-{p['id']}-{'-'.join(r['anyOf'])}"] = "aviso" if soft else "reprovada"

    blockers = [k for k, v in checks.items() if v == "reprovada"]
    return ServerValidation(
        approved=not blockers, checks=checks, blockers=blockers, dry_mass_kg=dry, wet_mass_kg=wet,
        component_cost_usd=components_usd, committed_usd=committed, delta_v_available_ms=dv_avail,
        launch_profile=profile_id, notes=notes,
    )
