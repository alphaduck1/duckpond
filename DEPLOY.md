# DEPLOY — the exact runbook

Everything is built and tested. To go live you run the commands below on a machine
with the `gcloud` CLI installed and logged in to your Google account. Total time:
~30–40 min, most of it waiting for Cloud SQL to create.

> Claude built and tested all of this but **cannot run the deploy** — it needs your
> GCP login, billing, and secrets, which only you have. That's by design.

---

## 0. One-time prep

> **gcloud needs Python 3.10–3.14.** Recent Cloud SDK refuses to run on the macOS
> system Python 3.9. If you hit "gcloud failed to load … Python 3.9 … no longer
> supported", install a supported Python and point gcloud at it:
> `export CLOUDSDK_PYTHON=/path/to/python3.12` (Google ships no bundled Python for macOS).

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

## 1. Push the code to your new GitHub repo
Create an **empty** repo on GitHub first (no README), then:
```bash
cd duckpond
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

## 2. Create the OAuth client (Sign in with Google)
Console → APIs & Services → Credentials → Create credentials → OAuth client ID →
**Web application**. Add Authorized JavaScript origin `http://localhost:3000` for now.
Copy the **Client ID**.

## 3. Create the database
```bash
# NOTE: --edition=ENTERPRISE is required — new instances default to Enterprise
# Plus, which rejects shared-core tiers like db-f1-micro.
gcloud sql instances create duckpond-db \
  --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro --region=europe-west2
gcloud sql databases create duckpond --instance=duckpond-db
gcloud sql users create duck --instance=duckpond-db --password=PICK_A_PASSWORD
```

## 4. Store the three secrets
```bash
CONN="$(gcloud sql instances describe duckpond-db --format='value(connectionName)')"
printf 'postgresql+psycopg://duck:PICK_A_PASSWORD@/duckpond?host=/cloudsql/%s' "$CONN" \
  | gcloud secrets create duckpond-db-url --data-file=-
openssl rand -base64 48 | gcloud secrets create duckpond-jwt --data-file=-
printf 'sk-ant-YOUR-ANTHROPIC-KEY' | gcloud secrets create duckpond-anthropic --data-file=-
```
Then grant the Cloud Run runtime service account `Secret Manager Secret Accessor`
and `Cloud SQL Client` (the console prompts you, or use
`gcloud projects add-iam-policy-binding`).

## 5. Deploy both services
```bash
export PROJECT_ID=YOUR_PROJECT_ID
export HOSTED_DOMAIN=bikeluggage.co.uk
export ADMIN_EMAILS=callum@bikeluggage.co.uk
export GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
export AGENT_CRON_TOKEN="$(openssl rand -hex 16)"   # remember this
bash deploy/deploy.sh
```
It prints your **web URL** and **API URL** when done.

## 6. Schedule the nightly self-improvement run
```bash
bash deploy/schedule-agents.sh   # uses the same PROJECT_ID + AGENT_CRON_TOKEN
```

## 7. (optional) Add Redis for speed
```bash
gcloud redis instances create duckpond-cache --size=1 --region=europe-west2 --tier=basic
# create a Serverless VPC connector, then:
export REDIS_URL=redis://REDIS_HOST:6379/0
export VPC_CONNECTOR=your-connector-name
bash deploy/deploy.sh   # redeploys with caching wired in
```

## 8. Final click
Add the printed **web URL** to your OAuth client's *Authorized JavaScript origins*
(step 2). Open the web URL, sign in with your company Google account — you're live.

> **Cloud Run gives the web service two URLs** (e.g. `…-HASH-REGION.a.run.app` and
> `…-PROJECTNUM.REGION.run.app`). Whichever you actually open must be in BOTH the
> OAuth *Authorized JavaScript origins* AND the backend `CORS_ORIGINS` (or sign-in
> fails with `origin_mismatch` / "Failed to fetch"). Adding both aliases is safest.
>
> **Access control:** `ALLOWED_HOSTED_DOMAIN` restricts to a whole Workspace domain.
> To lock sign-in to specific accounts instead, set `ALLOWED_EMAILS=a@x.com,b@x.com`
> (takes precedence over the domain check).

---

### Verify it's healthy
```bash
curl "$API_URL/api/healthz"        # -> {"ok":true}  (Cloud Run's GFE swallows the bare /healthz)
```
Sign in, complete a mission, then as Callum open the dashboard → "Run agents now"
to see the self-improvement queue populate.
