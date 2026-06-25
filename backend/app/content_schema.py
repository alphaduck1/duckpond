"""Pydantic contract for v2 missions.json. validate_content returns a list of
human-readable problems (empty = valid). This is the single source of truth the
content fan-out and the API both check against."""
from typing import Literal, Optional
from pydantic import BaseModel, ValidationError

PERSONAS = {"abbie", "emyr", "immy", "callum", "yas"}


class Session(BaseModel):
    week: int
    title: str
    goal: str
    concepts: list[str]


class Step(BaseModel):
    n: str
    h: str
    p: str


class SpotSide(BaseModel):
    txt: str
    correct: bool
    verdict: str


class Spot(BaseModel):
    q: str
    good: SpotSide
    bad: SpotSide


class QuizItem(BaseModel):
    q: str
    opts: list[str]
    a: int
    ex: str


class BuildBlock(BaseModel):
    template: str
    editable: list[str]
    steps: list[str]
    validateWith: str


class Mission(BaseModel):
    id: str
    session: int
    tier: Literal["core", "builder"]
    kind: Literal["standard", "build"]
    phase: str
    colour: str
    title: str
    real: str
    learn: dict          # {concept, body}
    steps: list[Step]
    doIt: str
    prompt: str
    spot: Spot
    quiz: list[QuizItem]
    apply: dict          # {q, placeholder}
    keep: Optional[dict] = None
    build: Optional[BuildBlock] = None


def validate_content(data: dict) -> list[str]:
    errs: list[str] = []
    for key in ("sessions", "people", "trace", "glossary", "missions"):
        if key not in data:
            errs.append(f"missing top-level key: {key}")
    if errs:
        return errs
    for sid, s in data["sessions"].items():
        try:
            Session(**s)
        except ValidationError as e:
            errs.append(f"session {sid}: {e}")
    for persona, missions in data["missions"].items():
        if persona not in PERSONAS:
            errs.append(f"unknown persona key: {persona}")
        for m in missions:
            try:
                mm = Mission(**m)
            except ValidationError as e:
                errs.append(f"mission {m.get('id', '?')}: {e}")
                continue
            if mm.kind == "build" and mm.build is None:
                errs.append(f"mission {mm.id}: kind=build requires a 'build' block")
            if mm.quiz and any(q.a >= len(q.opts) for q in mm.quiz):
                errs.append(f"mission {mm.id}: quiz answer index out of range")
    return errs
