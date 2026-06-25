"""The Duck Pond API — FastAPI + Pydantic + Postgres.

Routes:
  POST /api/auth/login          -> exchange Google credential for session JWT
  GET  /api/me                  -> current user
  POST /api/me/persona          -> set which persona (abbie/emyr/...) you are
  GET  /api/missions            -> the mission content (served from JSON)
  GET  /api/progress            -> my completed missions
  POST /api/progress/complete   -> mark a mission complete + store feedback
  POST /api/progress/reset      -> reset MY progress
  GET  /api/dashboard           -> team progress + feedback (admins only)
  POST /api/tts                 -> MP3 audio for read-aloud (Cloud TTS)
  GET  /healthz                 -> health check for Cloud Run
"""
import json
import io
import logging
from pathlib import Path
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from .config import get_settings
from .db import init_db, get_session
from .models import (
    User, Progress, Feedback, Proposal, AgentRun,
    UserOut, CompleteIn, ProgressOut, FeedbackOut, TTSIn, LoginIn, PersonaIn,
    SandboxRunIn,
)
from .auth import verify_google_credential, issue_session_jwt, current_user
from . import agents as agent_engine
from . import cache
from . import guardrails
from . import sandbox
from .content_schema import validate_content

logger = logging.getLogger("duckpond")

settings = get_settings()
app = FastAPI(title="The Duck Pond API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MISSIONS_PATH = Path(__file__).parent / "missions.json"


def _load_missions() -> dict:
    """Load missions.json from disk (uncached)."""
    return json.loads(MISSIONS_PATH.read_text()) if MISSIONS_PATH.exists() else {}


def _session_by_mission() -> dict[str, int]:
    """Map every mission id -> its session number, derived from missions.json.

    A shared mission id (e.g. 'reservoir', 'memory_all') appears under several
    personas with the same session, so a flat id->session map is unambiguous.
    """
    out: dict[str, int] = {}
    data = _load_missions()
    for ms in data.get("missions", {}).values():
        for m in ms:
            sid = m.get("session")
            if isinstance(sid, int):
                out[m["id"]] = sid
    return out


@app.on_event("startup")
def _startup():
    init_db()
    # Validate the v2 content shape on load. We log, we do NOT crash — bad
    # content should never take the API down; it just needs to be visible.
    try:
        errs = validate_content(_load_missions())
        if errs:
            logger.warning(
                "missions.json failed v2 content validation (%d issue(s)): %s",
                len(errs), " | ".join(errs[:20]),
            )
    except Exception as e:  # never let validation itself break startup
        logger.warning("content validation could not run: %s", e)


# NOTE: Cloud Run's front end (GFE) intercepts the literal path "/healthz"
# before it reaches the container, so we also expose it under "/api/healthz",
# which provably reaches the app. "/healthz" is kept for local/other runtimes.
@app.get("/healthz")
@app.get("/api/healthz")
def healthz():
    return {"ok": True}


# ---------------------------------------------------------------- auth
@app.post("/api/auth/login")
def login(body: LoginIn, session: Session = Depends(get_session)):
    info = verify_google_credential(body.credential)
    email = info["email"].lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        user = User(email=email)
    user.name = info.get("name", user.name or "")
    user.picture = info.get("picture", user.picture or "")
    user.is_admin = email in settings.admin_email_list
    user.last_seen = datetime.utcnow()
    session.add(user)
    session.commit()
    token = issue_session_jwt(email)
    return {"token": token, "user": UserOut(**user.model_dump())}


@app.get("/api/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return UserOut(**user.model_dump())


@app.post("/api/me/persona", response_model=UserOut)
def set_persona(body: PersonaIn, user: User = Depends(current_user),
                session: Session = Depends(get_session)):
    user.persona = body.persona
    session.add(user)
    session.commit()
    return UserOut(**user.model_dump())


# ------------------------------------------------------------ missions
@app.get("/api/missions")
def missions():
    cached = cache.get("missions")
    if cached is not None:
        return cached
    data = json.loads(MISSIONS_PATH.read_text()) if MISSIONS_PATH.exists() else {}
    cache.set("missions", data, ttl=300)
    return data


# ------------------------------------------------------------ progress
@app.get("/api/progress", response_model=ProgressOut)
def my_progress(persona: str, user: User = Depends(current_user),
                session: Session = Depends(get_session)):
    rows = session.exec(
        select(Progress).where(
            Progress.user_email == user.email, Progress.persona == persona
        )
    ).all()
    return ProgressOut(persona=persona, completed=[r.mission_id for r in rows])


@app.post("/api/progress/complete")
def complete(body: CompleteIn, user: User = Depends(current_user),
             session: Session = Depends(get_session)):
    exists = session.exec(
        select(Progress).where(
            Progress.user_email == user.email,
            Progress.persona == body.persona,
            Progress.mission_id == body.mission_id,
        )
    ).first()
    # Derive the session from the content so analytics can group by week.
    mission_session = _session_by_mission().get(body.mission_id)
    if not exists:
        session.add(Progress(
            user_email=user.email, persona=body.persona, mission_id=body.mission_id,
            session=mission_session,
        ))
    session.add(Feedback(
        user_email=user.email, persona=body.persona, mission_id=body.mission_id,
        session=mission_session,
        confidence=body.confidence, stars=body.stars, applied=body.applied,
        quiz=body.quiz, note=body.note,
    ))
    session.commit()
    cache.invalidate("dashboard")
    return {"ok": True}


@app.post("/api/progress/reset")
def reset(persona: str, user: User = Depends(current_user),
          session: Session = Depends(get_session)):
    for r in session.exec(select(Progress).where(
        Progress.user_email == user.email, Progress.persona == persona
    )).all():
        session.delete(r)
    session.commit()
    return {"ok": True}


# ----------------------------------------------------------- dashboard
@app.get("/api/dashboard")
def dashboard(user: User = Depends(current_user),
              session: Session = Depends(get_session)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    cached = cache.get("dashboard")
    if cached is not None:
        return cached
    progress = session.exec(select(Progress)).all()
    feedback = session.exec(select(Feedback)).all()
    users = {u.email: u for u in session.exec(select(User)).all()}
    fb_out = [
        FeedbackOut(
            user_email=f.user_email,
            name=users.get(f.user_email).name if users.get(f.user_email) else f.user_email,
            persona=f.persona, mission_id=f.mission_id, confidence=f.confidence,
            stars=f.stars, applied=f.applied, quiz=f.quiz, note=f.note,
            created_at=f.created_at,
        )
        for f in feedback
    ]
    completed = {}
    for p in progress:
        completed.setdefault(p.persona, set()).add(f"{p.user_email}:{p.mission_id}")

    # Derive session-per-mission from the content (single source of truth).
    sess_of = _session_by_mission()

    # by_session: per session, how many completions and how many low-confidence.
    by_session: dict[str, dict] = {}
    for p in progress:
        sid = sess_of.get(p.mission_id)
        if sid is None:
            continue
        bucket = by_session.setdefault(str(sid), {"completed": 0, "low_conf": 0})
        bucket["completed"] += 1
    for f in feedback:
        sid = sess_of.get(f.mission_id)
        if sid is None:
            continue
        bucket = by_session.setdefault(str(sid), {"completed": 0, "low_conf": 0})
        if f.confidence == "no":
            bucket["low_conf"] += 1

    # heatmap: one cell per feedback row — persona × mission, confidence + stars.
    heatmap = [
        {
            "persona": f.persona,
            "mission_id": f.mission_id,
            "confidence": f.confidence,
            "stars": f.stars,
        }
        for f in feedback
    ]

    # stuck: a learner is stuck on a mission if they said confidence == 'no',
    # or they have repeated (>= 2) low-mastery (<= 1 star) attempts on it.
    by_user_mission: dict[tuple, list] = {}
    for f in feedback:
        by_user_mission.setdefault((f.user_email, f.persona, f.mission_id), []).append(f)
    stuck = []
    for (email, persona, mid), rows in by_user_mission.items():
        said_no = any(r.confidence == "no" for r in rows)
        low_star = [r for r in rows if r.stars <= 1]
        repeated_low = len(low_star) >= 2
        if not (said_no or repeated_low):
            continue
        reason = "confidence=no" if said_no else "repeated low stars"
        name = users.get(email).name if users.get(email) else email
        stuck.append({
            "name": name, "persona": persona, "mission_id": mid, "reason": reason,
        })

    result = {
        "progress": [
            {"persona": k, "count": len(v)} for k, v in completed.items()
        ],
        "feedback": [f.model_dump() for f in fb_out],
        "applied_total": sum(1 for f in feedback if f.applied),
        "not_yet_total": sum(1 for f in feedback if f.confidence == "no"),
        "by_session": by_session,
        "heatmap": heatmap,
        "stuck": stuck,
    }
    cache.set("dashboard", result, ttl=30)
    return result


# ------------------------------------------------------------- sandbox
@app.get("/api/sandbox/templates")
def sandbox_templates(user: User = Depends(current_user)):
    """The catalogue of read-only build-sandbox templates. Auth required;
    available to every learner (not admin-only)."""
    return {"templates": sandbox.list_templates()}


@app.post("/api/sandbox/run")
def sandbox_run(body: SandboxRunIn, user: User = Depends(current_user)):
    """Run a scaffolded workflow safely (read-only) and return its steps +
    a TRACE prompt. Auth required; not admin-only. The engine never writes."""
    try:
        return sandbox.run_template(body.template_id, body.params or {}, user.email)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ------------------------------------------------ self-improvement agents
def _require_admin(user: User):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")


@app.post("/api/agents/run")
def agents_run(user: User = Depends(current_user),
               session: Session = Depends(get_session)):
    """On-demand: an admin triggers the engine now."""
    _require_admin(user)
    run = agent_engine.run_engine(session, trigger="manual")
    return {"ok": True, "summary": run.summary or run.error,
            "proposals_created": run.proposals_created}


@app.post("/api/agents/cron")
def agents_cron(x_cron_token: str = Header(default=""),
                session: Session = Depends(get_session)):
    """Nightly: Cloud Scheduler calls this with the shared token header."""
    if x_cron_token != settings.agent_cron_token:
        raise HTTPException(status_code=401, detail="Bad cron token")
    run = agent_engine.run_engine(session, trigger="scheduled")
    return {"ok": True, "summary": run.summary or run.error,
            "proposals_created": run.proposals_created}


@app.get("/api/proposals")
def list_proposals(status: str = "pending", user: User = Depends(current_user),
                   session: Session = Depends(get_session)):
    """The approval queue an admin reviews."""
    _require_admin(user)
    rows = session.exec(
        select(Proposal).where(Proposal.status == status)
        .order_by(Proposal.created_at.desc())
    ).all()
    return [r.model_dump() for r in rows]


@app.post("/api/proposals/{pid}/decide")
def decide_proposal(pid: int, decision: str, user: User = Depends(current_user),
                    session: Session = Depends(get_session)):
    """One-tap approve/reject. Approve = it goes live to everyone."""
    _require_admin(user)
    if decision not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision must be approved|rejected")
    prop = session.get(Proposal, pid)
    if not prop:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if decision == "approved":
        ok = agent_engine.apply_proposal(prop)
        if not ok:
            raise HTTPException(status_code=500, detail="Could not apply proposal")
        cache.invalidate("missions")  # content changed -> everyone gets the update
    prop.status = decision
    prop.decided_at = datetime.utcnow()
    prop.decided_by = user.email
    session.add(prop); session.commit()
    return {"ok": True, "status": prop.status}


@app.get("/api/agents/runs")
def agent_runs(user: User = Depends(current_user),
               session: Session = Depends(get_session)):
    _require_admin(user)
    rows = session.exec(select(AgentRun).order_by(AgentRun.started_at.desc())).all()
    return [r.model_dump() for r in rows[:20]]


# ----------------------------------------------------------------- TTS
@app.post("/api/tts")
def tts(body: TTSIn):
    if not settings.tts_enabled:
        raise HTTPException(status_code=503, detail="TTS disabled")
    try:
        from .tts import synthesize
        audio = synthesize(body.text)
    except Exception:
        # frontend will fall back to the browser voice
        raise HTTPException(status_code=503, detail="TTS unavailable")
    return StreamingResponse(io.BytesIO(audio), media_type="audio/mpeg")
