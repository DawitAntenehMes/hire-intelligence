"""
models/pipeline.py — Pydantic models for pipeline request/response.
Mirrors the JSON shapes expected by the existing frontend (pipeline.js).
"""

from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel


# ── Inbound ────────────────────────────────────────────────────────────────────

class ScenarioIn(BaseModel):
    id: str
    label: str
    description: str


class PipelineRequest(BaseModel):
    jd: str
    candidates: list[dict[str, Any]]
    scenario: ScenarioIn
    urgency_weeks: int = 8


class RerunRequest(BaseModel):
    adapted_jd: dict[str, Any]
    sourcing_result: dict[str, Any]
    candidates: list[dict[str, Any]]
    urgency_weeks: int = 8


# ── Outbound ───────────────────────────────────────────────────────────────────

class PipelineResponse(BaseModel):
    success: bool
    data: Optional[dict[str, Any]] = None
    duration_ms: Optional[int] = None
    error: Optional[str] = None
    stage: Optional[str] = None


class RerunResponse(BaseModel):
    success: bool
    data: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    stage: Optional[str] = None
