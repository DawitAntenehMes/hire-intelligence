"""
core/store.py — File-backed candidate store.

Persists candidates to data/candidates.json so they survive server restarts.
In-memory access remains thread-safe; disk writes happen on every add().
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Optional

from models.candidate import CandidateProfile

logger = logging.getLogger(__name__)

_STORE_FILE = Path(__file__).parent.parent / "data" / "candidates.json"


class CandidateStore:
    """Thread-safe candidate store backed by a JSON file."""

    def __init__(self) -> None:
        self._store: dict[str, CandidateProfile] = {}
        self._lock = threading.Lock()
        self._counter = 0
        self._load()

    # ── Persistence ────────────────────────────────────────────────────────

    def _load(self) -> None:
        """Load candidates from disk on startup."""
        if not _STORE_FILE.exists():
            return
        try:
            raw = json.loads(_STORE_FILE.read_text(encoding="utf-8"))
            for item in raw.get("candidates", []):
                profile = CandidateProfile(**item)
                self._store[profile.id] = profile
            # Restore counter to avoid id collisions after restart
            nums = [
                int(pid.split("_")[1])
                for pid in self._store
                if pid.startswith("cand_") and pid.split("_")[1].isdigit()
            ]
            self._counter = max(nums, default=0)
            logger.info("Loaded %d candidate(s) from %s", len(self._store), _STORE_FILE)
        except Exception as exc:
            logger.warning("Could not load candidates from disk: %s", exc)

    def _save(self) -> None:
        """Write the full store to disk. Must be called while holding _lock."""
        try:
            _STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
            data = {"candidates": [p.model_dump() for p in self._store.values()]}
            _STORE_FILE.write_text(
                json.dumps(data, indent=2, default=str), encoding="utf-8"
            )
        except Exception as exc:
            logger.warning("Could not save candidates to disk: %s", exc)

    # ── Write ──────────────────────────────────────────────────────────────

    def add(self, profile: CandidateProfile) -> CandidateProfile:
        """Store a candidate profile, persist to disk, and return it."""
        with self._lock:
            self._store[profile.id] = profile
            self._save()
        return profile

    def next_id(self) -> str:
        """Generate a sequential candidate id (thread-safe)."""
        with self._lock:
            self._counter += 1
            return f"cand_{self._counter:03d}"

    # ── Read ───────────────────────────────────────────────────────────────

    def get_all(self) -> list[CandidateProfile]:
        with self._lock:
            return list(self._store.values())

    def get_by_id(self, candidate_id: str) -> Optional[CandidateProfile]:
        with self._lock:
            return self._store.get(candidate_id)

    def count(self) -> int:
        with self._lock:
            return len(self._store)


# Module-level singleton used by all routers.
store = CandidateStore()
