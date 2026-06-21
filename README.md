# The Duck Pond — full-stack build

Agentic-AI training app for Bikeluggage & Motoplanet, rebuilt as a real web app
so **everyone's progress is stored centrally** (Callum sees the whole team), with
**Google sign-in** restricted to your company domain and a **natural read-aloud
voice** via Google Cloud TTS.

```
duckpond/
├── backend/        FastAPI + Pydantic + SQLModel (Postgres)   -> Cloud Run
│   └── app/
│       ├── main.py        API routes
│       ├── auth.py        Google token verify + session JWT
│       ├── models.py      User / Progress / Feedback tables
│       ├── tts.py         Google Cloud Text-to-Speech
│       ├── missions.json  all 23 missions (5 personas)
│       └── config.py      env settings
├── frontend/       Next.js 14 (App Router, TypeScript)        -> Cloud Run
└── deploy/         deploy.sh + cloud build config
```

The stack is **FastAPI + Pydantic + Postgres + Google OAuth + Next.js**, deployed to
**Cloud Run + Cloud SQL** — all on your GCP, in `europe-west2`.

---

## What you get

- **Google login** limited to `@bikeluggage.co.uk` (hosted-domain check). No-one
  outside the domain can get in.
- **Central database** — every completion, confidence rating, mastery score and
  "applied to real work" flag is stored in Postgres, not the browser.
- **Admin dashboard** (Callum + anyone in `ADMIN_EMAILS`) showing the whole team.
- **Read-aloud** uses Google Cloud TTS (natural female voice `en-GB-Chirp3-HD-Aoede`),
  and automatically falls back to the browser voice if TTS is ever unavailable.

> On voice: this uses a natural **AI** voice, not a cloned celebrity — cloning a real
> person's voice needs their consent and licence, so it's deliberately avoided.

---

## First-time setup (~30–40 min, once)

You need the `gcloud` CLI authenticated against your project and billing enabled.

### 1. Create the OAuth client (for "Sign in with Google")
1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type **Web application**.
3. Add **Authorized JavaScript origins**: `http://localhost:3000` for testing, and
   your deployed web URL once you have it (the deploy script prints it).
4. Copy the **Client ID** → this is `GOOGLE_CLIENT_ID`.

### 2. Create the Cloud SQL (Postgres) instance
```bash
gcloud sql instances create duckpond-db \
  --database-version=POSTGRES_16 --tier=db-f1-micro \
  --region=europe-west2
gcloud sql databases create duckpond --instance=duckpond-db
gcloud sql users create duck --instance=duckpond-db --password=PICK_A_PASSWORD
```

### 3. Store secrets in Secret Manager
The DB URL uses Cloud Run's Cloud SQL socket path:
```bash
CONN="$(gcloud sql instances describe duckpond-db --format='value(connectionName)')"

printf 'postgresql+psycopg://duck:PICK_A_PASSWORD@/duckpond?host=/cloudsql/%s' "$CONN" \
  | gcloud secrets create duckpond-db-url --data-file=-

# a long random session-signing key (>=32 bytes)
openssl rand -base64 48 | gcloud secrets create duckpond-jwt --data-file=-
```
Grant the Cloud Run service account access to both secrets and to Cloud SQL Client
(the console will prompt, or use `gcloud ... add-iam-policy-binding`).

### 4. Deploy
```bash
export PROJECT_ID=your-project
export HOSTED_DOMAIN=bikeluggage.co.uk
export ADMIN_EMAILS=callum@bikeluggage.co.uk
export GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
bash deploy/deploy.sh
```
The script builds both images, deploys both Cloud Run services, wires the database
and TTS, and prints the **web URL** and **API URL**.

### 5. Final click
Add the printed **web URL** to the OAuth client's *Authorized JavaScript origins*
(step 1). Sign in — you're in.

---

## Running locally (optional, for development)

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in GOOGLE_CLIENT_ID etc; a local Postgres or SQLite URL
uvicorn app.main:app --reload --port 8080
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:8080 + client id
npm run dev                 # http://localhost:3000
```

---

## Cost (rough, GBP/month)
Tiny for a team of 5: Cloud Run scales to zero when idle, Cloud SQL `db-f1-micro` is
the main fixed cost (~£7–10), Cloud TTS is a few pence at this volume. Expect well
under £15/month. To cut the SQL cost further you can stop the instance when unused.

## Security & performance (data leakage, guardrails, caching)

**No data leakage.** Three layers:
- *Input scrubbing* — every prompt sent to Claude is run through `guardrails.scrub()`
  first, redacting emails, phone numbers, card numbers, and credential-shaped
  strings (`password:`, `api_key=`, `sk-…`, Google tokens). Your real secrets in
  Notion never leave the system.
- *Output filtering* — every agent proposal is checked before it's queued. Anything
  that leaks PII **or invents an unverifiable product fact** (a specific SKU like
  `TR46`, a price like `£8,799`, a "2 year warranty") is auto-rejected and tagged
  so Callum sees why.
- *Tenant isolation* — `guardrails.assert_owns()` guarantees one person can never
  read another's data via the API; only an admin sees the aggregate dashboard.

**Guardrails.** The primary layer is a fast, dependency-light filter (above), chosen
so it adds ~no latency on Cloud Run. There's a clean seam (`guardrails.nemo_check`)
to layer in **NVIDIA NeMo Guardrails** later: add `nemoguardrails` to requirements,
drop a `backend/app/nemo_rails.py` exposing `nemo_validate(text) -> list[str]`, and
it's automatically included in every output check — no call-site changes.

**Caching (Redis / Memorystore) for low latency.** Hot reads — mission content,
the admin dashboard, the proposal list — are cached. In production set `REDIS_URL`
to a Cloud Memorystore instance; if it's unset or unreachable, the app transparently
falls back to an in-process cache and never hard-fails. Writes invalidate the right
keys (completing a mission clears the dashboard; approving a proposal clears missions
so everyone gets the update instantly).

To add Memorystore:
```bash
gcloud redis instances create duckpond-cache --size=1 --region=europe-west2 \
  --tier=basic
# note its host IP, create a Serverless VPC connector, then deploy with:
export REDIS_URL=redis://REDIS_HOST:6379/0
export VPC_CONNECTOR=your-connector-name
bash deploy/deploy.sh
```
Redis is optional — the app is fully functional without it (in-memory fallback).

## The self-improvement engine (3 agents + orchestrator)

The app improves itself. A nightly run (and an on-demand button for admins)
fires four cooperating agents — the same multi-agent pattern the app teaches:

1. **Feedback Analyst** — reads the whole team's data and finds the missions
   people struggle with (low confidence, low mastery, not applied). Read-only.
2. **Content Improver** — drafts clearer wording, a sharper quiz question, and
   a better step for the weakest missions (Claude API).
3. **Market Researcher** — uses Claude + web search to propose a brand-new
   mission on a current, relevant agentic-AI technique.
4. **Orchestrator** — runs the three and collects everything into one queue.

**Nothing auto-publishes.** Every output lands in an **approval queue**; an admin
(Callum) approves in one tap and *then* it goes live to everyone. This is on
purpose — it's the exact lesson the app teaches: *capability is not authorisation,
plausible ≠ true.* Auto-publishing unreviewed AI content to the team would
contradict the whole point.

Endpoints: `POST /api/agents/run` (admin, on-demand), `POST /api/agents/cron`
(Cloud Scheduler, token-gated), `GET /api/proposals?status=pending`,
`POST /api/proposals/{id}/decide?decision=approved|rejected`, `GET /api/agents/runs`.

Set up the nightly run after deploying:
```bash
export PROJECT_ID=your-project
export AGENT_CRON_TOKEN=the-same-token-as-the-backend
bash deploy/schedule-agents.sh
```
Requires `ANTHROPIC_API_KEY` set on the backend (store it in Secret Manager and
add `--set-secrets ANTHROPIC_API_KEY=duckpond-anthropic:latest` to the API deploy).

## Updating mission content
Edit `backend/app/missions.json` and redeploy the backend (`gcloud builds submit` +
`gcloud run deploy duckpond-api`, or just rerun `deploy.sh`). No frontend rebuild needed.

## Notes / honest caveats
- This is no longer a double-click HTML file — it needs hosting + a database, which is
  exactly what gives you shared, central data.
- The frontend bakes `NEXT_PUBLIC_API_URL` and the OAuth client ID at **build** time,
  so if either changes, rebuild the frontend image.
- Keep `JWT_SECRET` long and secret; rotating it logs everyone out (harmless).
