"""Guardrails — the "no data leakage" layer.

Primary defence is a fast, dependency-light input/output filter applied to
every agent call and every proposal before it can be stored or shown. It is
structured so NVIDIA NeMo Guardrails can be layered on later (see
`nemo_check` seam at the bottom) without changing call sites.

Three jobs:
  1. SCRUB inputs sent to the model so real secrets/PII never leave our system.
  2. BLOCK outputs that look like they leaked a secret, PII, or unverifiable
     product facts (SKUs, prices, warranty terms the model may hallucinate).
  3. ENFORCE tenant isolation in code paths (helpers used by the API layer).
"""
import re
from typing import Optional

# ----------------------------------------------------------------------
# Patterns we never want flowing INTO a prompt or OUT of the model.
# Deliberately broad: false positives just get redacted, which is safe.
# ----------------------------------------------------------------------
_PATTERNS = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "phone": re.compile(r"\b(?:\+?\d[\d\s().-]{7,}\d)\b"),
    "card": re.compile(r"\b(?:\d[ -]*?){13,19}\b"),
    # common credential-ish tokens seen in their Notion (kept generic, not the
    # actual values): API keys, bearer tokens, "password: ..." lines.
    "secret_kv": re.compile(
        r"(?i)\b(password|passwd|pwd|api[_-]?key|secret|token|bearer|auth)\b\s*[:=]\s*\S+"
    ),
    "sk_key": re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    "gtoken": re.compile(r"\bya29\.[A-Za-z0-9_-]+\b"),
}

# Product facts the model must not invent in learning content. If an output
# asserts a specific one of these, we flag it for the human (or auto-reject).
_UNVERIFIABLE = re.compile(
    r"(?i)("
    r"\bSKU\b\s*[:#]?\s*[A-Z0-9][A-Z0-9-]{2,}"   # specific SKU codes
    r"|£\s?\d{2,}(?:[.,]\d{2,3})?"                # specific prices e.g. £8799, £8,799
    r"|\b\d+\s*[- ]?year\s*warranty\b"           # specific warranty terms
    r"|\bTR\d{2,}\b|\bE0\d\b"                     # their real SKU shapes (TR46, E09)
    r")"
)


def scrub(text: str) -> str:
    """Redact secrets/PII before text is sent to the model. Never raises."""
    if not text:
        return text
    out = text
    for name, pat in _PATTERNS.items():
        out = pat.sub(f"[REDACTED_{name.upper()}]", out)
    return out


class GuardrailViolation(Exception):
    """Raised when an output must be blocked rather than redacted."""
    def __init__(self, reasons: list[str]):
        self.reasons = reasons
        super().__init__("; ".join(reasons))


def check_output(text: str, strict: bool = True) -> list[str]:
    """Return a list of guardrail reasons an output is unsafe (empty = clean).

    strict=True is used for anything that could go live to the team.
    """
    reasons = []
    if not text:
        return reasons
    for name, pat in _PATTERNS.items():
        if pat.search(text):
            reasons.append(f"contains possible {name}")
    if _UNVERIFIABLE.search(text):
        reasons.append("asserts an unverifiable product fact (SKU/price/warranty)")
    # NeMo seam (optional, off by default — see nemo_check)
    nemo = nemo_check(text)
    if nemo:
        reasons.extend(nemo)
    return reasons


def guard_proposal_payload(payload_text: str) -> Optional[str]:
    """For a proposal about to be queued: if the ORIGINAL trips strict checks
    (PII, secrets, unverifiable product facts), return a reason to auto-reject.
    We check the original — if an agent emitted a secret, we want it flagged,
    not silently scrubbed and passed through. Returns None if clean."""
    reasons = check_output(payload_text or "", strict=True)
    if reasons:
        return "; ".join(reasons)
    return None


# ----------------------------------------------------------------------
# Tenant isolation helpers (no cross-user data leakage).
# Used by the API layer so one person can never read another's data
# unless they are an admin viewing the aggregate dashboard.
# ----------------------------------------------------------------------
def assert_owns(requesting_email: str, row_email: str, is_admin: bool = False):
    if is_admin:
        return
    if requesting_email.lower() != (row_email or "").lower():
        raise GuardrailViolation(["cross-user data access blocked"])


# ----------------------------------------------------------------------
# NeMo Guardrails seam — optional, layered on later.
# If `nemoguardrails` is installed and a config is present, route the text
# through it here. Kept lazy so the base app has zero extra dependency.
# ----------------------------------------------------------------------
def nemo_check(text: str) -> list[str]:
    try:
        from .nemo_rails import nemo_validate  # provided only if you opt in
        return nemo_validate(text)
    except Exception:
        return []
