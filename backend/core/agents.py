"""
core/agents.py — All AI agent logic.

Agent 0: Extract a structured candidate profile from a CV + screening answers.
Agent 1: Reweight JD criteria based on the business scenario.
Agent 2: Evaluate internal vs. external sourcing.
Agent 3: Score each candidate per dimension.
Agent 4: Synthesise the final hiring recommendation.

All LLM calls go to OpenRouter via httpx (async).
Each agent retries up to 2 times on failure with exponential back-off.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

import httpx
from fastapi import HTTPException

from models.candidate import CandidateProfile, Education, Motivation

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct").strip()

# ── Avatar palette (cycles through for new candidates) ────────────────────────
_AVATAR_PALETTE = [
    ("#E8F1FB", "#1C69D4"),
    ("#dcfce7", "#16a34a"),
    ("#fef3c7", "#d97706"),
    ("#f3e8ff", "#7c3aed"),
    ("#fee2e2", "#dc2626"),
    ("#e0f2fe", "#0369a1"),
]
_palette_idx = 0


def _next_avatar() -> tuple[str, str]:
    global _palette_idx
    pair = _AVATAR_PALETTE[_palette_idx % len(_AVATAR_PALETTE)]
    _palette_idx += 1
    return pair


# ── Low-level helpers ──────────────────────────────────────────────────────────

def _clean_json(text: str) -> str:
    """Strip markdown fences that some models wrap around JSON responses."""
    text = re.sub(r"^```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


async def _call_llm(
    messages: list[dict[str, str]],
    max_tokens: int = 1500,
    retries: int = 2,
    agent_name: str = "agent",
) -> dict[str, Any]:
    """Send a chat completion request to OpenRouter and return parsed JSON."""
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not configured.")

    _app_url = os.getenv("APP_URL", "http://localhost:3001")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": _app_url,
        "X-Title": "Hire Intelligence",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    delay = 1.0
    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=120.0) as client:
        for attempt in range(retries + 1):
            try:
                t0 = time.monotonic()
                resp = await client.post(OPENROUTER_URL, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                duration_ms = int((time.monotonic() - t0) * 1000)
                logger.info("%s completed in %dms", agent_name, duration_ms)

                cleaned = _clean_json(content)
                try:
                    return json.loads(cleaned)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"{agent_name} returned invalid JSON: {cleaned[:300]}"
                    ) from exc

            except (httpx.HTTPStatusError, httpx.RequestError, ValueError) as exc:
                last_error = exc
                if attempt < retries:
                    logger.warning(
                        "%s attempt %d failed (%s), retrying in %.1fs",
                        agent_name, attempt + 1, exc, delay,
                    )
                    await asyncio.sleep(delay)
                    delay *= 2

    raise HTTPException(
        status_code=502,
        detail=f"{agent_name} failed after {retries + 1} attempts: {last_error}",
    )


# ── AGENT PROMPTS ──────────────────────────────────────────────────────────────

_AGENT0_SYSTEM = """You are an expert HR data analyst. You will receive the plain text of a candidate's CV and their answers to three screening questions. Extract a structured profile that captures ALL available information — do not omit anything relevant.

Return ONLY valid JSON — no preamble, no markdown fences, no explanation:
{
  "name": "Full Name",
  "current_role": "Most recent job title and company",
  "years_experience": 8,
  "availability_weeks": 4,
  "location": "City, Country",
  "type": "external",
  "key_skills": ["Skill 1", "Skill 2"],
  "notable_achievements": ["Achievement 1", "Achievement 2"],
  "leadership_style": "One concise phrase synthesized from CV and leadership_approach answer",
  "languages": ["English", "German"],
  "weaknesses": ["Gap 1", "Gap 2"],
  "education": [
    { "degree": "MBA", "university": "LMU Munich", "graduation_year": 2014 }
  ],
  "certifications": ["PMP", "APICS CSCP"],
  "salary_expectation": "€120k–€140k",
  "notice_period": "3 months",
  "references_available": true
}

Rules:
- name must be the full name exactly as written in the CV — do not abbreviate, infer from email, or fabricate
- type must be "external" (all applicants via this form are external)
- availability_weeks: if not stated, default to 8
- years_experience: count from first professional role to now
- notable_achievements: extract from CV AND incorporate the candidate's stated biggest_achievement answer as a distinct achievement item if it adds new information
- leadership_style: synthesize from CV evidence AND the leadership_approach screening answer — produce one concrete, specific phrase (not generic)
- weaknesses: infer 1–3 genuine gaps not explicitly stated if the CV does not list them
- key_skills: extract from the full CV AND the why_best_suited answer — include all substantive skills mentioned
- salary_expectation / notice_period: extract if mentioned; otherwise null
- graduation_year: integer or null if unknown
- If a field cannot be determined, use empty string for strings, [] for arrays, null for optional fields — never fabricate
- Output ONLY the JSON object"""

_AGENT1_SYSTEM = """You are a senior HR strategist. You will be given a job description and a business scenario. Your task is to reweight the JD criteria to reflect what the role actually needs in the current context.

Return ONLY valid JSON — no preamble, no markdown fences, no explanation:
{
  "adapted_criteria": [
    {
      "criterion": "Crisis operations",
      "original_weight": 10,
      "new_weight": 35,
      "reasoning": "Role now requires rapid vendor renegotiation under pressure"
    }
  ],
  "scenario_summary": "One sentence describing the business context and what it demands of this role"
}

Rules:
- All new_weight values must sum to exactly 100
- Never rename or remove a criterion — use the exact names from the JD
- reasoning must be one sentence, max 20 words
- Output ONLY the JSON object"""

_AGENT2_SYSTEM = """You are an HR sourcing strategist. Given the adapted job criteria and the candidate pool (tagged as internal or external), evaluate whether an internal hire is viable before recommending an external search.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "sourcing_recommendation": "internal",
  "internal_analysis": {
    "best_internal_candidate": "Name or null",
    "fit_score": 72,
    "speed_weeks": 2,
    "estimated_cost_eur": 5000,
    "risk_level": "low",
    "reasoning": "One sentence explaining the internal assessment"
  },
  "external_analysis": {
    "speed_weeks": 14,
    "estimated_cost_eur": 45000,
    "risk_level": "medium",
    "reasoning": "One sentence explaining the external assessment"
  },
  "recommendation_reasoning": "Two sentences explaining the final recommendation and what drives it."
}

Rules:
- sourcing_recommendation must be exactly "internal", "external", or "both"
- risk_level must be exactly "low", "medium", or "high"
- best_internal_candidate must be JSON null (not the string \"null\") if no internal candidates exist in the pool
- If no candidates in the pool have type="internal", set sourcing_recommendation to "external"
- Output ONLY the JSON object."""

_AGENT3_SYSTEM = """You are a structured hiring assessor. Score each candidate against the adapted JD criteria. Score EVERY criterion for EVERY candidate. Do NOT produce a single composite score — the per-dimension breakdown is the primary output.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "candidates": [
    {
      "name": "Anna Fischer",
      "source": "external",
      "availability_weeks": 6,
      "dimension_scores": [
        {
          "criterion": "Crisis operations",
          "weight": 35,
          "score": 95,
          "weighted_score": 33.25,
          "evidence": "Led 3 plant shutdowns and EMEA semiconductor recovery"
        }
      ],
      "total_weighted_score": 88.5,
      "rank": 1,
      "availability_note": "Available in 6 weeks. Meets urgency threshold.",
      "urgency_mismatch": false
    }
  ]
}

Rules:
- score is 0-100
- weighted_score = (score * weight) / 100
- total_weighted_score = sum of all weighted_scores, rounded to 2 decimal places
- rank candidates by total_weighted_score descending (rank 1 = highest)
- urgency_mismatch = true if availability_weeks > urgency_weeks
- evidence must be one concrete phrase from the candidate profile
- Candidate input fields use snake_case: availability_weeks, current_role, key_skills, notable_achievements, leadership_style
- source: copy the exact value of the candidate's "source" field from the input (either "internal" or "external")
- If a candidate lacks evidence for a criterion, set score to 0 and evidence to "No evidence found in profile"
- Output ONLY the JSON object"""

_AGENT4_SYSTEM = """You are a senior leadership hiring advisor. Given all outputs from the previous agents, write the final hire recommendation.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "recommended_candidate": "Anna Fischer",
  "recommended_source": "external",
  "headline_recommendation": "One decisive sentence — the hire decision and primary reason",
  "key_reasons": [
    "Reason 1 — specific and evidence-based",
    "Reason 2 — specific and evidence-based",
    "Reason 3 — specific and evidence-based"
  ],
  "tradeoff_statement": {
    "if_hire_recommended": "Name. Score: X. Available: Y weeks. Cost: €Z. Risk: level.",
    "if_hire_fastest": "Name. Score: X. Available: Y weeks. Re-hire risk: level within 18 months."
  },
  "confidence_level": "high",
  "confidence_reasoning": "One sentence explaining confidence level",
  "red_flags": ["Critical gap 1", "Critical gap 2"]
}

Rules:
- recommended_source must be "internal" or "external" — must match the actual type field of the recommended candidate
- confidence_level must be "high", "medium", or "low"
- key_reasons must have exactly 3 items
- red_flags can be empty array [] if no critical gaps
- if_hire_fastest must be \"N/A — same as recommended\" if the fastest-available candidate is the same person as the recommended candidate
- Output ONLY the JSON object"""


# ── Agent 0: CV extraction ─────────────────────────────────────────────────────

async def agent0_extract(
    cv_text: str,
    full_name_form: str,
    why_best_suited: str,
    biggest_achievement: str,
    leadership_approach: str,
    notice_period_form: str,
    salary_expectation_form: str,
    references_available_form: bool,
    candidate_id: str,
    is_internal: bool = False,
    position_title: str = "",
) -> CandidateProfile:
    """
    Call the LLM to extract a structured profile from CV text + screening answers.
    full_name_form is the authoritative source for name; LLM extraction is the fallback.
    """
    user_content = (
        f"CV TEXT:\n{cv_text}\n\n"
        f"SCREENING ANSWERS:\n"
        f"1. Why best suited for this role: {why_best_suited}\n"
        f"2. Biggest relevant achievement: {biggest_achievement}\n"
        f"3. Leadership approach: {leadership_approach}\n"
    )

    raw = await _call_llm(
        messages=[
            {"role": "system", "content": _AGENT0_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        max_tokens=1500,
        agent_name="agent0",
    )

    # Form name is authoritative; LLM extraction is the fallback.
    name: str = full_name_form.strip() or raw.get("name") or ""
    initials = "".join(w[0].upper() for w in name.split()[:2]) if name else ""
    avatar_color, avatar_text = _next_avatar()

    education = [
        Education(
            degree=e.get("degree", ""),
            university=e.get("university", ""),
            graduation_year=e.get("graduation_year"),
        )
        for e in (raw.get("education") or [])
        if isinstance(e, dict)
    ]

    # Merge biggest_achievement into notable_achievements if it adds new info
    llm_achievements: list[str] = list(raw.get("notable_achievements") or [])
    if biggest_achievement and len(biggest_achievement.strip()) >= 10:
        achievement_lower = biggest_achievement.strip().lower()
        already_present = any(achievement_lower in a.lower() or a.lower() in achievement_lower
                               for a in llm_achievements)
        if not already_present:
            llm_achievements.insert(0, biggest_achievement.strip())

    return CandidateProfile(
        id=candidate_id,
        name=name,
        initials=initials,
        applied_position=position_title,
        avatar_color=avatar_color,
        avatar_text=avatar_text,
        type="internal" if is_internal else "external",
        current_role=raw.get("current_role") or "",
        years_experience=int(raw.get("years_experience") or 0),
        availability_weeks=int(raw.get("availability_weeks") or 8),
        location=raw.get("location") or "",
        key_skills=raw.get("key_skills") or [],
        notable_achievements=llm_achievements,
        leadership_style=raw.get("leadership_style") or "",
        languages=raw.get("languages") or [],
        weaknesses=raw.get("weaknesses") or [],
        education=education,
        certifications=raw.get("certifications") or [],
        motivation=Motivation(
            why_best_suited=why_best_suited,
            biggest_achievement=biggest_achievement,
            leadership_approach=leadership_approach,
        ),
        salary_expectation=salary_expectation_form.strip() or raw.get("salary_expectation"),
        notice_period=notice_period_form.strip() or raw.get("notice_period"),
        references_available=references_available_form,
    )


# ── Agents 1–4: Pipeline ───────────────────────────────────────────────────────

async def run_agent1(jd: str, scenario_description: str) -> dict[str, Any]:
    raw = await _call_llm(
        messages=[
            {"role": "system", "content": _AGENT1_SYSTEM},
            {"role": "user", "content": f"JOB DESCRIPTION:\n{jd}\n\nBUSINESS SCENARIO:\n{scenario_description}"},
        ],
        max_tokens=1000,
        agent_name="agent1",
    )
    return {
        "adaptedCriteria": [
            {
                "criterion": c["criterion"],
                "originalWeight": c["original_weight"],
                "newWeight": c["new_weight"],
                "reasoning": c["reasoning"],
            }
            for c in raw.get("adapted_criteria", [])
        ],
        "scenarioSummary": raw.get("scenario_summary", ""),
    }


async def run_agent2(adapted_jd: dict, candidates: list[dict], urgency_weeks: int) -> dict[str, Any]:
    raw = await _call_llm(
        messages=[
            {"role": "system", "content": _AGENT2_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"ADAPTED JD CRITERIA:\n{json.dumps(adapted_jd, indent=2)}\n\n"
                    f"CANDIDATES:\n{json.dumps(candidates, indent=2)}\n\n"
                    f"URGENCY: Role must be filled within {urgency_weeks} weeks"
                ),
            },
        ],
        max_tokens=1000,
        agent_name="agent2",
    )
    ia = raw.get("internal_analysis", {})
    ea = raw.get("external_analysis", {})
    return {
        "sourcingRecommendation": raw.get("sourcing_recommendation", "external"),
        "internalAnalysis": {
            "bestInternalCandidate": ia.get("best_internal_candidate"),
            "fitScore": ia.get("fit_score", 0),
            "speedWeeks": ia.get("speed_weeks", 0),
            "estimatedCostEur": ia.get("estimated_cost_eur", 0),
            "riskLevel": ia.get("risk_level", "medium"),
            "reasoning": ia.get("reasoning", ""),
        },
        "externalAnalysis": {
            "speedWeeks": ea.get("speed_weeks", 0),
            "estimatedCostEur": ea.get("estimated_cost_eur", 0),
            "riskLevel": ea.get("risk_level", "medium"),
            "reasoning": ea.get("reasoning", ""),
        },
        "recommendationReasoning": raw.get("recommendation_reasoning", ""),
    }


async def run_agent3(adapted_jd: dict, candidates: list[dict], urgency_weeks: int) -> dict[str, Any]:
    # Ensure each candidate has a "source" field matching "type" so the LLM
    # outputs the correct field name and internal candidates are not misclassified.
    candidates_for_llm = [
        {**c, "source": c.get("type", "external")}
        for c in candidates
    ]
    raw = await _call_llm(
        messages=[
            {"role": "system", "content": _AGENT3_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"ADAPTED JD WEIGHTS:\n{json.dumps(adapted_jd.get('adaptedCriteria', []), indent=2)}\n\n"
                    f"CANDIDATES:\n{json.dumps(candidates_for_llm, indent=2)}\n\n"
                    f"URGENCY: {urgency_weeks} weeks"
                ),
            },
        ],
        max_tokens=2000,
        agent_name="agent3",
    )
    return {
        "candidates": [
            {
                "name": c.get("name", ""),
                "source": c.get("source", "external"),
                "availabilityWeeks": c.get("availability_weeks", 0),
                "dimensionScores": [
                    {
                        "criterion": d.get("criterion", ""),
                        "weight": d.get("weight", 0),
                        "score": d.get("score", 0),
                        "weightedScore": d.get("weighted_score", 0),
                        "evidence": d.get("evidence", ""),
                    }
                    for d in c.get("dimension_scores", [])
                ],
                "totalWeightedScore": c.get("total_weighted_score", 0),
                "rank": c.get("rank", 0),
                "availabilityNote": c.get("availability_note", ""),
                "urgencyMismatch": c.get("urgency_mismatch", False),
            }
            for c in raw.get("candidates", [])
        ]
    }


async def run_agent4(adapted_jd: dict, sourcing_result: dict, rankings: dict) -> dict[str, Any]:
    raw = await _call_llm(
        messages=[
            {"role": "system", "content": _AGENT4_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"ADAPTED JD:\n{json.dumps(adapted_jd, indent=2)}\n\n"
                    f"SOURCING ANALYSIS:\n{json.dumps(sourcing_result, indent=2)}\n\n"
                    f"CANDIDATE RANKINGS:\n{json.dumps(rankings, indent=2)}"
                ),
            },
        ],
        max_tokens=1200,
        agent_name="agent4",
    )
    ts = raw.get("tradeoff_statement", {})
    return {
        "recommendedCandidate": raw.get("recommended_candidate", ""),
        "recommendedSource": raw.get("recommended_source", "external"),
        "headlineRecommendation": raw.get("headline_recommendation", ""),
        "keyReasons": raw.get("key_reasons", []),
        "tradeoffStatement": {
            "ifHireRecommended": ts.get("if_hire_recommended", ""),
            "ifHireFastest": ts.get("if_hire_fastest", ""),
        },
        "confidenceLevel": raw.get("confidence_level", "medium"),
        "confidenceReasoning": raw.get("confidence_reasoning", ""),
        "redFlags": raw.get("red_flags", []),
    }


# ── Orchestrators ──────────────────────────────────────────────────────────────

async def run_pipeline(
    jd: str,
    candidates: list[dict],
    scenario: dict,
    urgency_weeks: int,
) -> tuple[dict, dict, dict, dict]:
    """Run all four pipeline agents sequentially. Returns (agent1, agent2, agent3, agent4)."""
    agent1 = await run_agent1(jd, scenario["description"])
    agent2 = await run_agent2(agent1, candidates, urgency_weeks)
    agent3 = await run_agent3(agent1, candidates, urgency_weeks)
    agent4 = await run_agent4(agent1, agent2, agent3)
    return agent1, agent2, agent3, agent4


async def run_rerun(
    adapted_jd: dict,
    sourcing_result: dict,
    candidates: list[dict],
    urgency_weeks: int,
) -> tuple[dict, dict]:
    """Re-run agents 3 & 4 with overridden JD weights. Returns (agent3, agent4)."""
    agent3 = await run_agent3(adapted_jd, candidates, urgency_weeks)
    agent4 = await run_agent4(adapted_jd, sourcing_result, agent3)
    return agent3, agent4
