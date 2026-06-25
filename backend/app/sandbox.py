"""The read-only build-sandbox engine.

Session 4's centrepiece: every persona assembles, runs and validates a small
multi-step / loop workflow. This module is the safe engine behind it.

HARD GUARANTEE — the engine is strictly read-only:
  * It only ever composes prompts and calls the model.
  * Every input param is run through ``guardrails.scrub`` before it touches a
    prompt, so secrets/PII never leave us.
  * Every step output is run through the existing output filter
    (``guardrails.check_output``); anything it trips is surfaced as ``flagged``,
    not silently passed.
  * It NEVER writes to any system — no DB, no files, no connectors. The
    learner sees what the workflow *would* produce, scores it with TRACE, and
    decides. Capability is not authorisation.

Template ids match the ``build`` blocks authored in the content
(``missions.json``): ``content-batch``, ``page-loop``, ``fitment-verify``.
"""
from typing import Callable

from .config import get_settings
from . import guardrails

settings = get_settings()


# ---------------------------------------------------------------- the model seam
def _call_model(prompt: str) -> str:
    """Run one prompt through Claude and return the text.

    This is the single seam the whole engine calls — tests monkeypatch it so
    runs are deterministic and offline. It wraps the SAME Anthropic client
    ``agents.py`` uses (lazy import, same settings) so behaviour matches the
    rest of the app, and so the app boots without the SDK/key configured.

    The prompt is scrubbed here too as a final defence in depth — even if a
    caller forgot, no secret/PII reaches the model.
    """
    from anthropic import Anthropic

    prompt = guardrails.scrub(prompt)
    client = Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model=settings.agent_model,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(
        b.text for b in msg.content if getattr(b, "type", "") == "text"
    ).strip()


# ---------------------------------------------------------------- templates
# Each template is an ordered list of (step_name, prompt_builder). A prompt
# builder takes the scrubbed editable params and returns the step prompt.
# Only the keys listed in ``editable`` are exposed to the learner as inputs.

def _content_batch_steps(p: dict) -> list[tuple[str, str]]:
    topic = p.get("topic", "")
    tone = p.get("tone", "")
    return [
        ("research",
         f"You are helping a UK motorcycle-accessories marketer. Gather the key "
         f"talking points and customer questions for content about: {topic}. "
         f"Do NOT invent product SKUs, prices or specs — keep facts generic or "
         f"mark anything you'd need to verify. Return a short bullet list."),
        ("draft",
         f"Using the research points, draft one short marketing paragraph about "
         f"{topic} in a {tone} tone. Plain UK English. No invented product facts."),
        ("self-check",
         f"Review the draft above for the topic '{topic}'. List anything that is "
         f"a claim needing verification (a SKU, price, spec or guarantee), and "
         f"flag any sentence that sounds confident but isn't grounded."),
    ]


def _page_loop_steps(p: dict) -> list[tuple[str, str]]:
    tone_rule = p.get("tone_rule", "")
    stop_condition = p.get("stop_condition", "")
    return [
        ("check-page",
         f"You are auditing a product page for brand voice. The brand rule is: "
         f"{tone_rule}. Read the (provided) page copy and judge whether it follows "
         f"the rule. Quote any line that breaks it."),
        ("flag-or-fix",
         f"For each line that breaks the rule '{tone_rule}', either flag it for a "
         f"human or suggest an on-brand rewrite. Never invent product facts."),
        ("next-page-until-clean",
         f"Decide whether to continue the loop to the next page or stop. "
         f"Stop condition: {stop_condition}. State 'CONTINUE' or 'STOP' and why."),
    ]


def _fitment_verify_steps(p: dict) -> list[tuple[str, str]]:
    bike_intake = p.get("bike_intake", "")
    policy_rule = p.get("policy_rule", "")
    return [
        ("intake",
         f"A customer says a part doesn't fit. Capture the intake details from: "
         f"{bike_intake}. Identify the make, model, year and registration if "
         f"present; note what's missing and must be asked for."),
        ("compatibility-check",
         f"Given the bike intake '{bike_intake}', describe how you'd check "
         f"compatibility. Use only verifiable fitment data — never guess a fit. "
         f"If you can't confirm, say so."),
        ("rule-out-reasons",
         f"Rule out the five common 'doesn't fit' reasons in order: wrong bike, "
         f"user error, aftermarket mods (tail-tidy vs panniers), wrong part sent, "
         f"faulty part. For intake '{bike_intake}', say which are likely/unlikely."),
        ("draft-reply",
         f"Draft a customer-service reply. Apply this policy rule: {policy_rule}. "
         f"Be warm, plain UK English, and never promise a fit you haven't verified "
         f"or invent a returns window."),
    ]


_TEMPLATES: dict[str, dict] = {
    "content-batch": {
        "title": "Build a 3-step content workflow — research, draft, self-check",
        "persona": "abbie",
        "editable": ["topic", "tone"],
        "builder": _content_batch_steps,
    },
    "page-loop": {
        "title": "Build a loop that checks every product page is on-brand",
        "persona": "emyr",
        "editable": ["tone_rule", "stop_condition"],
        "builder": _page_loop_steps,
    },
    "fitment-verify": {
        "title": "The Fitment diagnosis workflow — intake, check, rule out, reply",
        "persona": "immy",
        "editable": ["bike_intake", "policy_rule"],
        "builder": _fitment_verify_steps,
    },
}


# ---------------------------------------------------------------- public API
def list_templates() -> list[dict]:
    """Return the catalogue of sandbox templates the frontend can offer.

    Each entry: ``{id, title, persona, steps, editable}`` where ``steps`` is the
    ordered list of step names (the pre-wired workflow) and ``editable`` is the
    list of param keys the learner is allowed to tweak.
    """
    out = []
    for tid, t in _TEMPLATES.items():
        # Step names come from the builder so they can never drift from what runs.
        step_names = [name for name, _ in t["builder"]({})]
        out.append({
            "id": tid,
            "title": t["title"],
            "persona": t["persona"],
            "steps": step_names,
            "editable": list(t["editable"]),
        })
    return out


def run_template(template_id: str, params: dict, user_email: str) -> dict:
    """Run a sandbox template end-to-end (read-only) and return its results.

    Returns ``{steps: [{name, output, flagged: [...]}], trace_prompt}``.

    * ``params`` may contain only the template's editable keys; everything is
      scrubbed before it touches a prompt.
    * Each step output is passed through ``guardrails.check_output``; reasons
      land in that step's ``flagged`` list.
    * ``trace_prompt`` is the question the learner answers in the TRACE widget.

    The engine writes nothing anywhere — ``user_email`` is accepted for
    rate-limiting/attribution by the caller but never used to mutate state.
    """
    if template_id not in _TEMPLATES:
        raise ValueError(f"unknown template: {template_id}")

    t = _TEMPLATES[template_id]
    params = params or {}
    # Only honour editable keys, and scrub every value before use.
    safe_params = {
        k: guardrails.scrub(str(params.get(k, "")))
        for k in t["editable"]
    }

    steps_out = []
    for name, prompt in t["builder"](safe_params):
        raw = _call_model(prompt)
        flagged = guardrails.check_output(raw or "", strict=True)
        steps_out.append({"name": name, "output": raw, "flagged": flagged})

    trace_prompt = (
        f"Score this '{t['title']}' run against TRACE — Traceable, Real, "
        f"Accurate, Contained, Enough to act. Would you act on it as-is, or did a "
        f"step flag something you must verify first? And honestly: would one good "
        f"prompt have been faster than this whole workflow?"
    )
    return {"steps": steps_out, "trace_prompt": trace_prompt}
