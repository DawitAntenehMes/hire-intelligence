"""
api/pipeline.py — Pipeline and rerun endpoints.

POST /api/pipeline      — run all 4 agents (JD adapt → sourcing → scoring → decision)
POST /api/pipeline/rerun — re-run agents 3+4 with manually overridden JD weights
"""

import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from core import agents

router = APIRouter()


def _to_snake(c: dict) -> dict:
    """Normalise a camelCase candidate object (from frontend) to snake_case for agents."""
    return {
        "id": c.get("id", ""),
        "name": c.get("name", ""),
        "initials": c.get("initials", ""),
        "avatar_color": c.get("avatarColor") or c.get("avatar_color", ""),
        "avatar_text": c.get("avatarText") or c.get("avatar_text", ""),
        "type": c.get("type", "external"),
        "current_role": c.get("currentRole") or c.get("current_role", ""),
        "years_experience": c.get("yearsExperience") or c.get("years_experience", 0),
        "availability_weeks": c.get("availabilityWeeks") or c.get("availability_weeks", 8),
        "location": c.get("location", ""),
        "key_skills": c.get("keySkills") or c.get("key_skills") or [],
        "notable_achievements": c.get("notableAchievements") or c.get("notable_achievements") or [],
        "leadership_style": c.get("leadershipStyle") or c.get("leadership_style", ""),
        "languages": c.get("languages") or [],
        "weaknesses": c.get("weaknesses") or [],
        "education": c.get("education") or [],
        "certifications": c.get("certifications") or [],
        "salary_expectation": c.get("salaryExpectation") or c.get("salary_expectation"),
        "notice_period": c.get("noticePeriod") or c.get("notice_period"),
        "references_available": c.get("referencesAvailable") or c.get("references_available", False),
        "linked_in": c.get("linkedIn") or c.get("linked_in"),
        "motivation": c.get("motivation"),
    }


@router.post("/pipeline")
async def run_pipeline(request: Request) -> dict[str, Any]:
    body = await request.json()

    jd: str = body.get("jd", "")
    candidates: list = body.get("candidates", [])
    scenario: dict = body.get("scenario", {})
    urgency_weeks: int = int(body.get("urgencyWeeks", 8))

    if not jd or not candidates or not urgency_weeks:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": "Missing required fields: jd, candidates, urgencyWeeks",
                "stage": "unknown",
            },
        )

    # scenario is optional — supply a neutral fallback when not provided
    if not scenario or not scenario.get("description"):
        scenario = {
            "id": None,
            "label": "No scenario",
            "description": "No specific business scenario provided — apply standard JD criteria weights.",
        }

    normalised_candidates = [_to_snake(c) for c in candidates]

    t0 = time.monotonic()
    agent1, agent2, agent3, agent4 = await agents.run_pipeline(
        jd=jd,
        candidates=normalised_candidates,
        scenario=scenario,
        urgency_weeks=urgency_weeks,
    )
    duration_ms = int((time.monotonic() - t0) * 1000)

    return {
        "success": True,
        "data": {"agent1": agent1, "agent2": agent2, "agent3": agent3, "agent4": agent4},
        "durationMs": duration_ms,
    }


@router.post("/pipeline/rerun")
async def rerun_pipeline(request: Request) -> dict[str, Any]:
    body = await request.json()

    adapted_jd: dict = body.get("adaptedJD", {})
    sourcing_result: dict = body.get("sourcingResult", {})
    candidates: list = body.get("candidates", [])
    urgency_weeks: int = int(body.get("urgencyWeeks", 8))

    if not adapted_jd or not adapted_jd.get("adaptedCriteria"):
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": "adaptedJD with adaptedCriteria is required for rerun",
            },
        )

    normalised_candidates = [_to_snake(c) for c in candidates]

    agent3, agent4 = await agents.run_rerun(
        adapted_jd=adapted_jd,
        sourcing_result=sourcing_result,
        candidates=normalised_candidates,
        urgency_weeks=urgency_weeks,
    )

    return {"success": True, "data": {"agent3": agent3, "agent4": agent4}}
