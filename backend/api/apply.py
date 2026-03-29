"""
api/apply.py — Candidate application intake endpoint.

POST /api/apply  (multipart/form-data)
  Fields:
    cv_file            — required, PDF or DOCX
    why_best_suited    — required, screening question answer
    biggest_achievement — required, screening question answer
    leadership_approach — required, screening question answer
    notice_period      — optional
    salary_expectation — optional
    references_available — optional bool (default false)
    linked_in          — optional, only included if candidate provides it

Response: the parsed CandidateProfile (JSON).
"""

from fastapi import APIRouter, Form, HTTPException, UploadFile

from core.agents import agent0_extract
from core.cv_parser import extract_text
from core.store import store
from models.candidate import CandidateProfile

router = APIRouter()

_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/apply", response_model=CandidateProfile, status_code=201)
async def apply(
    cv_file: UploadFile,
    full_name: str = Form(default=""),
    why_best_suited: str = Form(...),
    biggest_achievement: str = Form(...),
    leadership_approach: str = Form(...),
    notice_period: str = Form(default=""),
    salary_expectation: str = Form(default=""),
    references_available: bool = Form(default=False),
    linked_in: str = Form(default=""),
    is_internal: bool = Form(default=False),
    position_title: str = Form(default=""),
) -> CandidateProfile:
    # ── Validate file size ─────────────────────────────────────────────────
    # We need to read the file to check size; cv_parser will read again via reset
    initial_bytes = await cv_file.read()
    if len(initial_bytes) > _MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="CV file must be under 10 MB.")
    await cv_file.seek(0)  # reset for cv_parser

    # ── Validate screening answers ─────────────────────────────────────────
    if len(why_best_suited.strip()) < 10:
        raise HTTPException(
            status_code=422,
            detail="Please provide a meaningful answer to 'Why are you best suited?'",
        )

    # ── Extract text from CV ───────────────────────────────────────────────
    cv_text = await extract_text(cv_file)

    # ── Generate candidate id ──────────────────────────────────────────────
    candidate_id = store.next_id()

    # ── Run Agent 0 ────────────────────────────────────────────────────────
    profile = await agent0_extract(
        cv_text=cv_text,
        full_name_form=full_name,
        why_best_suited=why_best_suited.strip(),
        biggest_achievement=biggest_achievement.strip(),
        leadership_approach=leadership_approach.strip(),
        notice_period_form=notice_period,
        salary_expectation_form=salary_expectation,
        references_available_form=references_available,
        linked_in_form=linked_in,
        candidate_id=candidate_id,
        is_internal=is_internal,
        position_title=position_title.strip(),
    )

    # ── Persist ────────────────────────────────────────────────────────────
    store.add(profile)

    return profile
