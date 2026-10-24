"""Testes de integração da API (SQLite temporário ou PostgreSQL via TEST_DATABASE_URL)."""
import json
from pathlib import Path

VECTORS = {c["name"]: c for c in json.loads((Path(__file__).resolve().parents[2] / "data/test-vectors/validation-vectors.json").read_text(encoding="utf-8"))["cases"]}


def _session(client, name="Equipe Teste"):
    r = client.post("/api/v1/sessions", json={"playerName": name})
    assert r.status_code == 201, r.text
    return r.json()


def _campaign(vector_name="leo-climate-referencia", cid="c0ffee00-0000-4000-8000-000000000001", **over):
    i = VECTORS[vector_name]["input"]
    body = {
        "id": cid, "playerName": "Equipe Teste", "missionId": i["missionId"], "assistance": i["assistance"], "stage": "briefing",
        "spacecraft": i["spacecraft"], "vehicleId": i["vehicleId"], "plan": i["plan"], "derived": i["derived"],
        "flightOutcome": "pending", "attempt": 1, "versions": {"components": "x"}, "report": None, "flightEvents": [],
    }
    body.update(over)
    return body


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["database"] == "ok"


def test_session_name_rules(client):
    assert client.post("/api/v1/sessions", json={"playerName": "    "}).status_code == 422
    assert client.post("/api/v1/sessions", json={"playerName": "x" * 33}).status_code == 422
    assert client.post("/api/v1/sessions", json={"playerName": "<script>"}).status_code == 422
    s = _session(client, "  Ana   Maria  ")
    assert s["playerName"] == "Ana Maria"
    assert len(s["token"]) > 30


def test_auth_required_and_isolated(client):
    assert client.get("/api/v1/campaigns").status_code == 401
    assert client.get("/api/v1/campaigns", headers={"X-Session-Token": "invalido"}).status_code == 401
    a, b = _session(client, "A"), _session(client, "B")
    ha, hb = {"X-Session-Token": a["token"]}, {"X-Session-Token": b["token"]}
    body = _campaign()
    assert client.put(f"/api/v1/campaigns/{body['id']}", json=body, headers=ha).status_code == 200
    # Outra sessão não lê nem sobrescreve a campanha
    assert client.get(f"/api/v1/campaigns/{body['id']}", headers=hb).status_code == 404
    assert client.put(f"/api/v1/campaigns/{body['id']}", json=body, headers=hb).status_code == 404


def test_save_and_revision(client):
    h = {"X-Session-Token": _session(client)["token"]}
    body = _campaign()
    r1 = client.put(f"/api/v1/campaigns/{body['id']}", json=body, headers=h).json()
    r2 = client.put(f"/api/v1/campaigns/{body['id']}", json={**body, "stage": "launch-pad"}, headers=h).json()
    assert (r1["revision"], r2["revision"]) == (1, 2)
    got = client.get(f"/api/v1/campaigns/{body['id']}", headers=h).json()["campaign"]
    assert got["stage"] == "launch-pad"
    assert client.get("/api/v1/campaigns", headers=h).json()["campaigns"][0]["id"] == body["id"]


def test_server_validation_matches_vectors(client):
    h = {"X-Session-Token": _session(client)["token"]}
    for name in ("leo-climate-referencia", "lunar-he3-sls", "jupiter-system-starship-pendente", "leo-climate-tanque-excedido"):
        body = _campaign(name)
        r = client.post(f"/api/v1/campaigns/{body['id']}/validate", json=body, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["approved"] == VECTORS[name]["expected"]["approved"], name
        assert r.json()["checks"] == VECTORS[name]["expected"]["checks"], name


def test_rejects_unknown_component_and_bad_input(client):
    h = {"X-Session-Token": _session(client)["token"]}
    body = _campaign()
    body["spacecraft"] = {**body["spacecraft"], "installed": [{"instanceId": "i1", "componentId": "warp-drive"}]}
    assert client.post(f"/api/v1/campaigns/{body['id']}/validate", json=body, headers=h).status_code == 422
    bad = _campaign()
    bad["spacecraft"] = {**bad["spacecraft"], "propellantKg": -5}
    assert client.put(f"/api/v1/campaigns/{bad['id']}", json=bad, headers=h).status_code == 422
    assert client.put("/api/v1/campaigns/outro-id-123", json=_campaign(), headers=h).status_code == 422


def _report(classification="sucesso", science=80.0):
    return {"playerName": "Equipe Teste", "missionId": "leo-climate", "missionName": "x", "vehicleName": "Falcon 9", "components": [],
            "budgetUSD": 1, "finalCostUSD": 1, "launchResult": "", "trajectoryResult": "", "objectives": [], "dataCollectedGb": 0,
            "dataReturnedGb": 0, "criticalEvents": [], "failures": [], "remainingPropellantKg": 0, "scienceScore": science,
            "finalScore": science, "classification": classification, "classificationLabel": "", "educational": [], "recommendations": [], "generatedAt": ""}


def test_finalize_accepts_approved_and_recomputes_cost(client):
    h = {"X-Session-Token": _session(client)["token"]}
    body = _campaign(flightOutcome="orbit", report=_report())
    client.post(f"/api/v1/campaigns/{body['id']}/events", json={"events": []}, headers=h)
    r = client.post(f"/api/v1/campaigns/{body['id']}/finalize", json=body, headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["serverChecks"]["approved"] is True
    assert data["report"]["classification"] == "sucesso"
    assert data["report"]["finalCostUSD"] > 1_000_000  # recalculado pelo servidor, não o valor enviado
    reports = client.get("/api/v1/reports", headers=h).json()["reports"]
    assert len(reports) == 1 and reports[0]["attempt"] == 1
    # Repetir a finalização da mesma tentativa atualiza, não duplica
    client.post(f"/api/v1/campaigns/{body['id']}/finalize", json=body, headers=h)
    assert len(client.get("/api/v1/reports", headers=h).json()["reports"]) == 1


def test_finalize_rejects_tampered_launch(client):
    """Uma configuração reprovada que alega ter voado é registrada como fracassada pelo servidor."""
    h = {"X-Session-Token": _session(client)["token"]}
    body = _campaign("lunar-he3-sls", flightOutcome="orbit", report=_report("sucesso", 95))
    data = client.post(f"/api/v1/campaigns/{body['id']}/finalize", json=body, headers=h).json()
    assert data["serverChecks"]["approved"] is False
    assert "budget-total" in data["serverChecks"]["blockers"]
    assert data["report"]["classification"] == "fracassada"
    assert data["report"]["scienceScore"] == 0


def test_finalize_validates_scores(client):
    h = {"X-Session-Token": _session(client)["token"]}
    body = _campaign(flightOutcome="orbit", report=_report("sucesso", 150))
    assert client.post(f"/api/v1/campaigns/{body['id']}/finalize", json=body, headers=h).status_code == 422
    body = _campaign(flightOutcome="orbit", report=_report("lendaria", 50))
    assert client.post(f"/api/v1/campaigns/{body['id']}/finalize", json=body, headers=h).status_code == 422


def test_events_are_stored(client):
    h = {"X-Session-Token": _session(client)["token"]}
    body = _campaign()
    client.put(f"/api/v1/campaigns/{body['id']}", json=body, headers=h)
    ev = [{"t": 1.5, "phase": "ascent", "id": "maxq", "label": "Max-Q", "severity": "info"}]
    assert client.post(f"/api/v1/campaigns/{body['id']}/events", json={"events": ev}, headers=h).json() == {"stored": 1}
    bad = [{"t": 1, "phase": "x", "id": "y", "label": "z", "severity": "apocaliptica"}]
    assert client.post(f"/api/v1/campaigns/{body['id']}/events", json={"events": bad}, headers=h).status_code == 422
