"""
api/candidates.py — Read-only endpoint to list all parsed applicants.

GET /api/candidates
  Returns the list of all candidate profiles stored in memory.
  The pipeline setup page fetches from here instead of using a hardcoded JS array.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from core.store import store
from models.candidate import CandidateProfile

router = APIRouter()


@router.get("/candidates", response_model=list[CandidateProfile])
async def list_candidates() -> list[CandidateProfile]:
    return store.get_all()


@router.delete("/candidates/{candidate_id}", status_code=204)
async def delete_candidate(candidate_id: str) -> Response:
    removed = store.remove(candidate_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return Response(status_code=204)
