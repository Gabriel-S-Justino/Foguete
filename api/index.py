"""Entrada da função Python na Vercel: expõe a aplicação FastAPI do diretório backend/."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402

__all__ = ["app"]
