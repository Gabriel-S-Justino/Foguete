"""Aplicação FastAPI. Em produção (Vercel) é servida por api/index.py; localmente por uvicorn."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .routers.api import router

settings = get_settings()
app = FastAPI(title="Space Mission Architect API", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-Session-Token"],
)
app.include_router(router)
