"""Database models (SQLModel = SQLAlchemy + Pydantic) and API schemas.

Central store for everything: users, mission progress, and feedback.
This is what makes the data shared across the whole team instead of
living in one person's browser.
"""
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field
from pydantic import BaseModel


# ----------------------------------------------------------------------
# Tables
# ----------------------------------------------------------------------
class User(SQLModel, table=True):
    __tablename__ = "users"
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    name: str = ""
    picture: str = ""
    # the team persona they map to (abbie/emyr/immy/callum/yas), optional
    persona: Optional[str] = Field(default=None, index=True)
    is_admin: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen: datetime = Field(default_factory=datetime.utcnow)


class Progress(SQLModel, table=True):
    """One row per (user, mission) that has been completed."""
    __tablename__ = "progress"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_email: str = Field(index=True)
    persona: str = Field(index=True)            # which mission-set
    mission_id: str = Field(index=True)
    completed_at: datetime = Field(default_factory=datetime.utcnow)


class Feedback(SQLModel, table=True):
    """One row per mission completion: confidence, mastery, applied, note."""
    __tablename__ = "feedback"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_email: str = Field(index=True)
    persona: str = Field(index=True)
    mission_id: str = Field(index=True)
    confidence: str = "yes"        # yes | nearly | no
    stars: int = 0                 # 0..3 mastery
    applied: bool = False          # did they do it on real work?
    quiz: str = ""                 # e.g. "2/2"
    note: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Proposal(SQLModel, table=True):
    """An AI-generated improvement awaiting one-tap human approval.

    This is the safety valve: agents generate autonomously, but nothing
    reaches the team until an admin approves it. 'plausible != true'.
    """
    __tablename__ = "proposals"
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(index=True)          # improve_mission | new_mission | insight
    persona: Optional[str] = Field(default=None, index=True)
    mission_id: Optional[str] = Field(default=None, index=True)
    title: str = ""                        # short human-readable summary
    rationale: str = ""                    # why the agent proposes this (from data)
    payload: str = ""                      # JSON: the actual proposed change/content
    source_agent: str = ""                 # which agent produced it
    status: str = Field(default="pending", index=True)  # pending|approved|rejected
    created_at: datetime = Field(default_factory=datetime.utcnow)
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None


class AgentRun(SQLModel, table=True):
    """Log of each time the self-improvement engine ran."""
    __tablename__ = "agent_runs"
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
    trigger: str = "manual"                # manual | scheduled
    proposals_created: int = 0
    summary: str = ""
    error: str = ""


# ----------------------------------------------------------------------
# API schemas (request/response) — Pydantic
# ----------------------------------------------------------------------
class UserOut(BaseModel):
    email: str
    name: str
    picture: str
    persona: Optional[str] = None
    is_admin: bool = False


class CompleteIn(BaseModel):
    persona: str
    mission_id: str
    confidence: str = "yes"
    stars: int = 0
    applied: bool = False
    quiz: str = ""
    note: str = ""


class ProgressOut(BaseModel):
    persona: str
    completed: list[str]


class FeedbackOut(BaseModel):
    user_email: str
    name: str
    persona: str
    mission_id: str
    confidence: str
    stars: int
    applied: bool
    quiz: str
    note: str
    created_at: datetime


class TTSIn(BaseModel):
    text: str


class LoginIn(BaseModel):
    credential: str   # Google ID token (JWT) from Google Identity Services


class PersonaIn(BaseModel):
    persona: str
