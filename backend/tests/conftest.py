import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Cliente HTTP contra um banco isolado: TEST_DATABASE_URL (PostgreSQL) ou SQLite temporário."""
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    from app import config, db
    config.get_settings.cache_clear()
    db.reset_engine()
    from app.models import Base
    engine = db.get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(engine)
    db.reset_engine()
