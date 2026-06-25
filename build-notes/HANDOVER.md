# The Duck Pond v2 — Handover

Branch: `duckpond-v2`. Live v1 is untouched; v2 is a fresh, separate deploy (see
"Deploy" below). This document covers what changed, how to run locally, the open
`‹verify›` items, and the exact deploy steps for the separate v2 service.

## What changed in v2

The Duck Pond went from a flat list of ~23 missions into a structured **4-week
agentic-AI masterclass** for the 5-person Bikeluggage/Motoplanet team. Stack is
unchanged (FastAPI + SQLModel/Postgres backend, Next.js 14 App Router frontend,
Google OAuth, Cloud TTS). The Google-OAuth / persona / read-aloud flow is intact.

### Content (`backend/app/missions.json`)
- **Sessions.** New top-level `sessions` object, weeks 1–4:
  1. *What is this thing, really?* (foundations: fluency isn't truth)
  2. *Claude that acts — and the one rule* (the Reservoir read-only rule, memory, security)
  3. *Stop repeating yourself* (skills, connectors)
  4. *Agents working together — and how to trust them* (build + TRACE capstone)
- **Standardised on Claude.** The per-mission Claude-vs-Codex `toolGuide` is
  removed; each mission now has a Claude-first `doIt` line. The wider tool
  landscape is taught in one shared `tools_all` mission (when to reach for Codex /
  Gemini, plus intra-Claude Opus/Sonnet/Haiku selection).
- **New per-mission fields:** `session` (1–4), `tier` (`core`|`builder`),
  `kind` (`standard`|`build`), `doIt`, and a `build` block on build missions.
- **New missions** (highlights):
  - `fitment_detective` (Immy, S2) — mines the real email corpus for how past
    "it doesn't fit" cases resolved, structured on the 5-reason taxonomy
    (wrong bike / user error / aftermarket mods / wrong part sent / faulty part);
    read-only + PII-safe, efficient querying.
  - `s4_immy` reframed into the **fitment-verify** workflow (intake → compatibility
    → rule-out 5 reasons → policy-checked reply).
  - `a_analysis` (Abbie) + `e_analysis` (Emyr) — real marketing/brand questions
    across the Reservoir market + analytics layers.
  - `outcome_first` (shared, S1) — "begin with the end": write the good answer in
    one sentence before prompting; the companion to TRACE.
  - Shared blocks: `tokens_all`, `memory_all`, `connect_all`,
    `reservoir_shape_all` (raw→staging→core→marts), `security_all` (PII/GDPR +
    prompt injection), `trace_capstone` (subtle-failure catch + audit trail).
- **Build missions** (`kind:"build"`, one per persona, S4):
  - `s4_abbie` → template `content-batch`
  - `s4_emyr` → template `page-loop`
  - `s4_immy` → template `fitment-verify`
  - `s4_callum` → `self-improvement-engine` (operating the live engine + queue)
  - `s4_yas` → `agents-py` (builder tier, real code-level multi-agent flow)
- **Glossary.** New top-level `glossary` (18 terms → plain-English + farm/sheepdog
  analogy), powering frontend tooltips.
- Mission counts: abbie 15, emyr 15, immy 15, callum 14, yas 14.

### Backend (`backend/app/`)
- `content_schema.py` (new) — Pydantic contract for v2 `missions.json`;
  `validate_content(data) -> list[str]` (empty = valid) is the single source of
  truth the content and `/api/missions` both check against.
- `sandbox.py` (new) — the **read-only build-sandbox engine**. `list_templates()`
  and `run_template(template_id, params, user_email)`. Composes step prompts,
  passes input/output through `guardrails`, never writes to any system. Templates:
  `content-batch`, `page-loop`, `fitment-verify`. Routes (auth required):
  `GET /api/sandbox/templates`, `POST /api/sandbox/run`.
- `main.py` — serves `sessions`/`glossary`; runs `validate_content` on startup
  (logs a warning, does not crash); upgraded `/api/dashboard` now returns
  `by_session`, `heatmap`, and `stuck` (admins only, cached).

### Frontend (`frontend/`)
The single `page.tsx` was split into views/components (CSS classes + api helper
reused):
- `app/views/SessionHub.tsx` — Weeks 1–4 hub, missions grouped by `m.session`.
- `app/views/Journey.tsx` — My Journey + Kept Toolkit (the `keep` artifacts).
- `app/views/Sandbox.tsx` — scaffolded build UI (template → tweak editable params
  → run → step outputs with flagged items → TRACE → "one prompt faster?" reflection).
- `app/views/AdminDashboard.tsx` — per-session row + persona×mission confidence
  heatmap + "who's stuck", alongside the existing self-improvement proposal queue.
- `app/components/TraceWidget.tsx` — interactive TRACE scorer (per-letter pass/fail
  → "fit to act?" verdict), replacing the static 5-button board.
- `app/components/Glossary.tsx` — `GlossaryProvider` + `<Term>` tooltip layer.

### Deploy (`deploy/`)
- `deploy.sh` parametrised by `SERVICE_PREFIX` (default `duckpond` = v1). Every
  Cloud Run service, Cloud SQL instance, and secret name is namespaced, so v2
  deploys as a completely separate stack.
- `deploy/V2.md` (new) — the exact v2 deploy procedure.

## How to run locally

Backend (FastAPI, SQLite locally):
```bash
cd backend
python3 -m pytest tests/ -v            # 19 tests, all passing
# serve: uvicorn app.main:app --reload  (needs Python deps installed)
```

Validate content:
```bash
cd backend
python3 -c "import json; from app.content_schema import validate_content; print(validate_content(json.load(open('app/missions.json'))) or 'CLEAN')"
```

Frontend (Next.js 14):
```bash
cd frontend
npm install
npm run build      # production build — clean
npm run dev        # local dev server
```

## Verification status (this gate)
- Backend tests: **19 passed** (content schema, content missions, dashboard, sandbox).
- Frontend build: **clean** (compiled successfully, no type errors).
- Content validation: **CLEAN** (`validate_content` returns `[]`).

## Open `‹verify›` items (for Yas/Callum)

The `‹…›` markers in `missions.json` are mostly **intentional**: fill-in-the-blank
prompt templates for learners (e.g. `‹winter touring luggage›`, `‹describe the
repeated task…›`, `‹amount›`) and one deliberate synthetic-PII example in
`memory_all` (`J. Hargreaves, 14 Mill Lane, order #1042`) used to teach "never
store PII". These should stay.

The genuine facts still needing human confirmation are:

1. **SH39 IP rating** (`‹SH39 IP rating›`, Immy's `trace_capstone` spot/quiz).
   The SHAD SH39 top box is verified as 39L (title "SHAD SH39 Top Box - 39 Litres",
   handle `shad-sh39-top-box-39-litres-d0b39100`), but its waterproof / IP rating
   is **not in the product record** — confirm before it is ever claimed.
2. **Returns-policy window** (referenced in the fitment / `s4_immy` flow as a value
   the workflow must refuse to invent). This is **not in BigQuery** and must be
   supplied from the real Bikeluggage returns policy before any reply quotes a
   specific window. Until then the missions correctly teach "flag, don't guess".

## Deploy — EXACT steps (DO NOT run as part of this gate)

v2 deploys to a **separate** Cloud Run + Cloud SQL stack via `SERVICE_PREFIX`.
Full detail (one-time Cloud SQL + secret setup, resource-name table) is in
`deploy/V2.md`. The deploy itself:

```bash
export SERVICE_PREFIX=duckpond-v2
export PROJECT_ID=<gcp-project-id>
export HOSTED_DOMAIN=bikeluggage.co.uk
export ADMIN_EMAILS=callum@bikeluggage.co.uk
export GOOGLE_CLIENT_ID=<oauth-client-id>
# REGION defaults to europe-west2

bash deploy/deploy.sh
```

This creates/updates `duckpond-v2-api` and `duckpond-v2-web` (Cloud Run),
backed by the `duckpond-v2-db` Cloud SQL instance and `duckpond-v2-*` secrets —
all separate from v1's `duckpond-*` resources. After it prints the web URL, add
that URL to the Google OAuth client's Authorized JavaScript origins. v1 is never
touched (its `SERVICE_PREFIX` default is `duckpond`).

**Not run here:** no `gcloud` / Cloud Run / Cloud SQL commands were executed
during this handover gate.

## Updating content later

Edit `backend/app/missions.json`, re-run `validate_content` (must be `CLEAN`) and
`python3 -m pytest tests/ -v`, commit, then redeploy with the steps above.
