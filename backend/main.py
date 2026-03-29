"""
main.py — FastAPI application entry point.

Starts up the full Hire Intelligence backend:
  - Loads OPENROUTER_API_KEY from .env.local
  - Registers all API routers under /api
  - Mounts the frontend static files from the parent directory
  - Serves index.html at GET /

Run with:
    uvicorn main:app --reload --port 3001
"""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


# ── Load environment variables from .env.local (BOM-safe) ────────────────────
def _load_env(path: Path) -> None:
    """Parse a .env file that may be UTF-8, UTF-8-BOM, or UTF-16 (Windows)."""
    if not path.exists():
        return
    raw = path.read_bytes()
    # Detect byte-order marks and decode accordingly
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = raw.decode("utf-16")
    elif raw[:3] == b"\xef\xbb\xbf":
        text = raw.decode("utf-8-sig")
    else:
        text = raw.decode("utf-8")
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            # Don't overwrite values already set in the real environment
            os.environ.setdefault(key.strip(), value.strip())


_load_env(Path(__file__).parent / ".env.local")

if not os.getenv("OPENROUTER_API_KEY"):
    print(
        "ERROR: OPENROUTER_API_KEY is not set.\n"
        "Create backend/.env.local with: OPENROUTER_API_KEY=sk-or-your-key-here",
        file=sys.stderr,
    )
    sys.exit(1)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("hire_intelligence")

# ── Import routers (after env is loaded) ─────────────────────────────────────
from api.apply import router as apply_router          # noqa: E402
from api.candidates import router as candidates_router  # noqa: E402
from api.health import router as health_router        # noqa: E402
from api.pipeline import router as pipeline_router    # noqa: E402

# ── App factory ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def _lifespan(app: FastAPI):
    key_preview = os.getenv("OPENROUTER_API_KEY", "")[:10]
    model = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct")
    logger.info("Hire Intelligence API started")
    logger.info("  API key : %s...", key_preview)
    logger.info("  Model   : %s", model)
    logger.info("  Docs    : http://localhost:3001/api/docs")
    logger.info("  App     : http://localhost:3001")
    yield


app = FastAPI(
    title="Hire Intelligence API",
    description="Multi-agent AI hiring pipeline — BMW Digital Excellence Hub",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=_lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# In production set APP_URL in .env.local (e.g. https://your-deployed-app.com)
_app_url = os.getenv("APP_URL", "").strip()
_allowed_origins = [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5500",   # VS Code Live Server
    "http://127.0.0.1:5500",
]
if _app_url and _app_url not in _allowed_origins:
    _allowed_origins.append(_app_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "X-Request-Id"],
)

# ── API routes ─────────────────────────────────────────────────────────────────
app.include_router(health_router, prefix="/api")
app.include_router(apply_router, prefix="/api")
app.include_router(candidates_router, prefix="/api")
app.include_router(pipeline_router, prefix="/api")

# ── Static frontend files ─────────────────────────────────────────────────────
# The frontend lives one level up from this file (the repo root).
_frontend_root = Path(__file__).parent.parent

# Serve sub-directories explicitly so /api routes are not shadowed.
for _subdir in ("css", "js", "data"):
    _path = _frontend_root / _subdir
    if _path.is_dir():
        app.mount(f"/{_subdir}", StaticFiles(directory=str(_path)), name=_subdir)


@app.get("/", include_in_schema=False)
async def serve_index() -> FileResponse:
    return FileResponse(str(_frontend_root / "index.html"))


@app.get("/{page_name}.html", include_in_schema=False)
async def serve_page(page_name: str) -> FileResponse:
    """Serve any top-level HTML page (e.g. /apply.html)."""
    target = _frontend_root / f"{page_name}.html"
    if not target.exists():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Page not found")
    return FileResponse(str(target))
