"""Leitura dos catálogos versionados em /data (mesma fonte de verdade do frontend)."""
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import get_settings


def _load(rel: str) -> dict[str, Any]:
    path: Path = get_settings().data_dir / rel
    with path.open(encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def catalog() -> dict[str, Any]:
    components = _load("components/components.json")
    vehicles = _load("launch-vehicles/launch-vehicles.json")
    missions = _load("missions/missions.json")
    simulation = _load("simulation/simulation-config.json")
    constants = _load("scientific-sources/constants.json")
    return {
        "components": {c["id"]: c for c in components["components"]},
        "vehicles": {v["id"]: v for v in vehicles["vehicles"]},
        "profiles": vehicles["profiles"],
        "missions": {m["id"]: m for m in missions["missions"]},
        "test_campaigns": missions["testCampaigns"],
        "assistance": simulation["assistance"],
        "g0": constants["parameters"].get("g0", {}).get("value", 9.80665),
        "versions": {
            "components": components["version"],
            "launchVehicles": vehicles["version"],
            "missions": missions["version"],
            "simulation": simulation["version"],
            "constants": constants["version"],
        },
    }
