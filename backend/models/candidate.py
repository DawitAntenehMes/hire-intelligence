"""
models/candidate.py — Pydantic models for candidate profiles.
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class Education(BaseModel):
    degree: str
    university: str
    graduation_year: Optional[int] = None


class Motivation(BaseModel):
    why_best_suited: str = ""
    biggest_achievement: str = ""
    leadership_approach: str = ""


class CandidateProfile(BaseModel):
    # ── Core identity ──────────────────────────────────────────────────────
    id: str
    name: str = ""
    initials: str = ""
    applied_position: str = ""
    avatar_color: str = Field(default="#E8F4FD")
    avatar_text: str = Field(default="#1C69D4")
    type: str = "external"  # "internal" | "external"

    # ── Professional background ────────────────────────────────────────────
    current_role: str = ""
    years_experience: int = 0
    availability_weeks: int = 8
    location: str = ""
    key_skills: list[str] = []
    notable_achievements: list[str] = []
    leadership_style: str = ""
    languages: list[str] = []
    weaknesses: list[str] = []

    # ── Extended fields (extracted by Agent 0) ─────────────────────────────
    education: list[Education] = []
    certifications: list[str] = []
    motivation: Motivation = Field(default_factory=Motivation)
    salary_expectation: Optional[str] = None
    notice_period: Optional[str] = None
    references_available: bool = False
    linked_in: Optional[str] = None  # Optional — privacy respected

    def to_pipeline_dict(self) -> dict:
        """
        Full camelCase representation for pipeline agents.
        Includes all extracted fields so agents have full context.
        """
        return {
            "id": self.id,
            "name": self.name,
            "initials": self.initials,
            "appliedPosition": self.applied_position,
            "avatarColor": self.avatar_color,
            "avatarText": self.avatar_text,
            "type": self.type,
            "currentRole": self.current_role,
            "yearsExperience": self.years_experience,
            "availabilityWeeks": self.availability_weeks,
            "location": self.location,
            "keySkills": self.key_skills,
            "notableAchievements": self.notable_achievements,
            "leadershipStyle": self.leadership_style,
            "languages": self.languages,
            "weaknesses": self.weaknesses,
            "education": [
                {
                    "degree": e.degree,
                    "university": e.university,
                    "graduationYear": e.graduation_year,
                }
                for e in self.education
            ],
            "certifications": self.certifications,
            "salaryExpectation": self.salary_expectation,
            "noticePeriod": self.notice_period,
            "referencesAvailable": self.references_available,
            "linkedIn": self.linked_in,
            "motivation": {
                "whyBestSuited": self.motivation.why_best_suited,
                "biggestAchievement": self.motivation.biggest_achievement,
                "leadershipApproach": self.motivation.leadership_approach,
            },
        }
