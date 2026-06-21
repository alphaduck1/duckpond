"""The self-improvement engine — three agents + an orchestrator.

Design principle (the same one the app teaches):
    Agents GENERATE autonomously. Humans APPROVE in one tap.
    Capability is not authorisation. Plausible is not true.

Agents
------
1. FeedbackAnalyst  — reads team data, finds weak missions (read-only).
2. ContentImprover  — drafts better wording/quiz/steps for weak missions.
3. MarketResearcher — uses Claude + web search to propose new missions.

Everything they produce lands in the `proposals` table as `pending`,
and reaches the team only when an admin approves it via /api/proposals.
"""
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from sqlmodel import Session, select

from .config import get_settings
from .models import Feedback, Progress, Proposal, AgentRun
from . import guardrails

settings = get_settings()
MISSIONS_PATH = Path(__file__).parent / "missions.json"


# ---------------------------------------------------------------- Claude
def _claude(system: str, user: str, use_web: bool = False) -> str:
    """Call the Claude API and return the text. Lazy import so the app
    boots without the SDK/key; agents simply no-op if unconfigured.

    Guardrail: every input is scrubbed of secrets/PII BEFORE it leaves us.
    """
    from anthropic import Anthropic

    system = guardrails.scrub(system)
    user = guardrails.scrub(user)
    client = Anthropic(api_key=settings.anthropic_api_key)
    kwargs = dict(
        model=settings.agent_model,
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if use_web:
        kwargs["tools"] = [{"type": "web_search_20250305", "name": "web_search"}]
    msg = client.messages.create(**kwargs)
    # concatenate any text blocks
    return "".join(
        b.text for b in msg.content if getattr(b, "type", "") == "text"
    ).strip()


def _json_only(text: str):
    """Pull a JSON object/array out of a model response."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1].lstrip("json").strip()
    start = min((text.find("{") if "{" in text else 1e9),
                (text.find("[") if "[" in text else 1e9))
    if start < 1e9:
        text = text[int(start):]
    try:
        return json.loads(text)
    except Exception:
        return None


def _load_missions():
    return json.loads(MISSIONS_PATH.read_text()) if MISSIONS_PATH.exists() else {}


# ------------------------------------------------- Agent 1: FeedbackAnalyst
def feedback_analyst(session: Session) -> list[dict]:
    """Read-only. Aggregate feedback per mission and flag the weak ones.

    A mission is 'weak' if people report low confidence, low mastery, or
    don't apply it to real work. Returns a ranked list of weak missions.
    """
    fb = session.exec(select(Feedback)).all()
    by_mission = defaultdict(list)
    for f in fb:
        by_mission[(f.persona, f.mission_id)].append(f)

    weak = []
    for (persona, mid), rows in by_mission.items():
        n = len(rows)
        not_yet = sum(1 for r in rows if r.confidence == "no")
        nearly = sum(1 for r in rows if r.confidence == "nearly")
        applied = sum(1 for r in rows if r.applied)
        avg_stars = sum(r.stars for r in rows) / n if n else 0
        notes = [r.note for r in rows if r.note]
        # simple weakness score: struggling confidence + low apply + low mastery
        score = (not_yet * 2 + nearly) + (n - applied) + (3 - avg_stars)
        weak.append({
            "persona": persona, "mission_id": mid, "n": n,
            "not_yet": not_yet, "nearly": nearly, "applied": applied,
            "avg_stars": round(avg_stars, 2), "notes": notes,
            "score": round(score, 2),
        })
    weak.sort(key=lambda x: x["score"], reverse=True)
    return weak


# ------------------------------------------------ Agent 2: ContentImprover
IMPROVER_SYSTEM = (
    "You improve micro-learning missions for a UK motorcycle-accessories team "
    "(Bikeluggage / Motoplanet) learning to use Claude and Codex as agentic AI. "
    "Each mission teaches a real work task and how to validate AI output. "
    "You write in plain, encouraging UK English. You NEVER invent product facts, "
    "SKUs, prices, warranty terms, or data — if unknown, keep it generic. "
    "Return ONLY valid JSON, no preamble."
)


def content_improver(session: Session, weak: list[dict], missions: dict) -> list[Proposal]:
    proposals = []
    for w in weak[:3]:  # top 3 weakest only — keep the queue reviewable
        persona, mid = w["persona"], w["mission_id"]
        mission = next((m for m in missions.get("missions", {}).get(persona, [])
                        if m["id"] == mid), None)
        if not mission:
            continue
        notes_blob = " | ".join(w["notes"][:6]) or "(no written notes)"
        user = (
            f"Mission people are struggling with:\n{json.dumps(mission)[:2500]}\n\n"
            f"Signal: {w['not_yet']} said 'not yet', {w['nearly']} 'nearly', "
            f"avg mastery {w['avg_stars']}/3, applied {w['applied']}/{w['n']}.\n"
            f"Their notes: {notes_blob}\n\n"
            "Propose focused improvements. Return JSON: "
            '{"learn_body": "clearer concept explanation", '
            '"extra_quiz": {"q": "...", "opts": ["A","B"], "a": 0, "ex": "..."}, '
            '"clearer_step": {"h":"heading","p":"plain step"}, '
            '"why": "one line on what this fixes"}'
        )
        try:
            out = _json_only(_claude(IMPROVER_SYSTEM, user))
        except Exception:
            out = None
        if not out:
            continue
        proposals.append(Proposal(
            kind="improve_mission", persona=persona, mission_id=mid,
            title=f"Improve “{mission['title']}”",
            rationale=(f"{w['not_yet']} ‘not yet’, {w['nearly']} ‘nearly’, "
                       f"avg {w['avg_stars']}/3 mastery, applied {w['applied']}/{w['n']}. "
                       + out.get("why", "")),
            payload=json.dumps(out), source_agent="ContentImprover",
        ))
    return proposals


# ----------------------------------------------- Agent 3: MarketResearcher
RESEARCH_SYSTEM = (
    "You research what a small UK motorcycle-accessories retail team (5 people: "
    "marketing, customer service, founder, engineer) should learn next about "
    "agentic AI with Claude and Codex. You look for genuinely useful, current "
    "techniques or workflows. You propose ONE new mission, grounded and practical, "
    "never inventing their internal data. Return ONLY valid JSON, no preamble."
)


def market_researcher(session: Session, missions: dict) -> list[Proposal]:
    existing = []
    for p, ms in missions.get("missions", {}).items():
        existing += [m["title"] for m in ms]
    user = (
        "Find one current, practical agentic-AI technique or workflow this team "
        "doesn't already cover, and design a new mission around it.\n"
        f"Already covered: {json.dumps(existing)[:1500]}\n\n"
        "Return JSON: {"
        '"title": "...", "persona": "abbie|emyr|immy|callum|yas", '
        '"real": "the real task framing", '
        '"learn": {"concept":"...","body":"..."}, '
        '"why_now": "why this is worth learning now (cite what you found)"}'
    )
    try:
        out = _json_only(_claude(RESEARCH_SYSTEM, user, use_web=True))
    except Exception:
        out = None
    if not out:
        return []
    return [Proposal(
        kind="new_mission", persona=out.get("persona"),
        title=f"New mission: {out.get('title','(untitled)')}",
        rationale=out.get("why_now", "Proposed from market research."),
        payload=json.dumps(out), source_agent="MarketResearcher",
    )]


# -------------------------------------------------------- Orchestrator
def run_engine(session: Session, trigger: str = "manual") -> AgentRun:
    """The pit-crew chief: run all three agents, queue their proposals."""
    run = AgentRun(trigger=trigger)
    session.add(run); session.commit(); session.refresh(run)

    if not settings.agents_enabled or not settings.anthropic_api_key:
        run.finished_at = datetime.utcnow()
        run.error = "Agents disabled or ANTHROPIC_API_KEY not set."
        session.add(run); session.commit()
        return run

    created = 0
    try:
        missions = _load_missions()
        weak = feedback_analyst(session)              # agent 1 (read-only)

        # Always log the top insight so admins see the diagnosis even with no changes.
        if weak:
            top = weak[0]
            session.add(Proposal(
                kind="insight", persona=top["persona"], mission_id=top["mission_id"],
                title="Feedback insight: weakest mission this cycle",
                rationale=(f"Highest struggle score ({top['score']}). "
                           f"{top['not_yet']} ‘not yet’, applied {top['applied']}/{top['n']}."),
                payload=json.dumps(top), source_agent="FeedbackAnalyst",
            )); created += 1

        for p in content_improver(session, weak, missions):  # agent 2
            reason = guardrails.guard_proposal_payload(p.payload + " " + p.rationale)
            if reason:
                p.status = "rejected"; p.rationale = f"[auto-blocked: {reason}] " + p.rationale
            session.add(p); created += 1
        for p in market_researcher(session, missions):       # agent 3
            reason = guardrails.guard_proposal_payload(p.payload + " " + p.rationale)
            if reason:
                p.status = "rejected"; p.rationale = f"[auto-blocked: {reason}] " + p.rationale
            session.add(p); created += 1

        run.summary = (f"Analysed {len(weak)} missions with feedback; "
                       f"queued {created} proposals for approval.")
    except Exception as e:  # never let a bad run corrupt anything
        run.error = str(e)[:500]
    finally:
        run.proposals_created = created
        run.finished_at = datetime.utcnow()
        session.add(run); session.commit()
    return run


# ----------------------------------------------- applying an approved item
def apply_proposal(prop: Proposal) -> bool:
    """Apply an approved proposal to missions.json (the live content).

    Only 'improve_mission' and 'new_mission' change content; 'insight' is
    informational. This is what 'going live to everyone' actually does.
    """
    data = _load_missions()
    payload = _json_only(prop.payload) or {}
    try:
        if prop.kind == "improve_mission":
            for m in data["missions"].get(prop.persona, []):
                if m["id"] == prop.mission_id:
                    if payload.get("learn_body"):
                        m.setdefault("learn", {})["body"] = payload["learn_body"]
                    if payload.get("extra_quiz"):
                        m.setdefault("quiz", []).append(payload["extra_quiz"])
                    if payload.get("clearer_step"):
                        s = payload["clearer_step"]
                        m.setdefault("steps", []).append(
                            {"n": f"Step {len(m['steps'])+1}", "h": s["h"], "p": s["p"]})
                    break
        elif prop.kind == "new_mission":
            persona = payload.get("persona") or prop.persona or "abbie"
            new_id = f"ai{len(data['missions'].get(persona, []))+1}"
            data["missions"].setdefault(persona, []).insert(-2 if len(data["missions"].get(persona, [])) >= 2 else 0, {
                "id": new_id, "phase": "New · proposed", "colour": "#33B06A",
                "title": payload.get("title", "New mission"),
                "real": payload.get("real", ""),
                "learn": payload.get("learn", {"concept": "", "body": ""}),
                "steps": [{"n": "Step 1", "h": "Try it", "p": payload.get("real", "")}],
                "prompt": payload.get("real", ""),
                "spot": {"q": "Does the output show its source?",
                         "good": {"txt": "Shows real data/source.", "correct": True, "verdict": "Checkable."},
                         "bad": {"txt": "Sounds right, no source.", "correct": False, "verdict": "Verify first."}},
                "quiz": [{"q": "Before trusting AI output you…", "opts": ["Check the source", "Trust the tone"], "a": 0,
                          "ex": "Plausible is not true — always check."}],
                "apply": {"q": "Do this on your real work and paste what you got.", "placeholder": "Your result…"},
                "keep": {"label": "prompt", "desc": "Reusable.", "text": payload.get("real", "")},
            })
        else:
            return True  # insight: nothing to apply
        MISSIONS_PATH.write_text(json.dumps(data, indent=2))
        return True
    except Exception:
        return False
