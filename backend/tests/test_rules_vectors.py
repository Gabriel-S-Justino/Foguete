"""O servidor deve reproduzir exatamente os vetores gerados pelo motor TypeScript."""
import json
from pathlib import Path

import pytest

from app.rules import RuleInputError, validate

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "data/test-vectors/validation-vectors.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_vector(case):
    i, e = case["input"], case["expected"]
    r = validate(i["missionId"], i["spacecraft"], i["vehicleId"], i["assistance"], i["plan"], i["derived"])
    assert r.checks == e["checks"]
    assert r.approved == e["approved"]
    assert r.launch_profile == i["derived"]["launchProfile"]
    assert r.dry_mass_kg == pytest.approx(e["dryMassKg"], abs=1e-9)
    assert r.wet_mass_kg == pytest.approx(e["wetMassKg"], abs=1e-9)
    assert r.component_cost_usd == pytest.approx(e["componentCostUSD"], abs=1e-6)
    assert r.committed_usd == pytest.approx(e["committedUSD"], rel=1e-12)
    assert r.delta_v_available_ms == pytest.approx(e["deltaVAvailableMS"], rel=1e-12)


def test_rejects_unknown_component():
    with pytest.raises(RuleInputError):
        validate("leo-climate", {"installed": [{"instanceId": "x", "componentId": "warp-drive"}], "propellantKg": 0, "testCampaign": "standard"}, None, "iniciante", None, None)


def test_rejects_unknown_vehicle_and_negative_propellant():
    sc = {"installed": [], "propellantKg": 0, "testCampaign": "standard"}
    with pytest.raises(RuleInputError):
        validate("leo-climate", sc, "saturn-v", "iniciante", None, None)
    with pytest.raises(RuleInputError):
        validate("leo-climate", {**sc, "propellantKg": -1}, None, "iniciante", None, None)
