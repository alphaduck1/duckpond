#!/usr/bin/env bash
# ============================================================
# The Duck Pond — deploy to Google Cloud Run (backend + frontend)
# Run from the repo root:  bash deploy/deploy.sh
# Prereqs: gcloud CLI authenticated, billing enabled, the env
# vars below set. See README.md for the full first-time setup.
# ============================================================
set -euo pipefail

# ---- EDIT THESE -------------------------------------------------
PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-europe-west2}"
SQL_INSTANCE="${SQL_INSTANCE:-duckpond-db}"          # Cloud SQL instance name
DB_NAME="${DB_NAME:-duckpond}"
DB_USER="${DB_USER:-duck}"
HOSTED_DOMAIN="${HOSTED_DOMAIN:?set HOSTED_DOMAIN e.g. bikeluggage.co.uk}"
ADMIN_EMAILS="${ADMIN_EMAILS:?set ADMIN_EMAILS e.g. callum@bikeluggage.co.uk}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID}"
# ----------------------------------------------------------------

AR_REPO="duckpond"
CONN_NAME="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

echo "==> Enabling required APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  artifactregistry.googleapis.com texttospeech.googleapis.com \
  secretmanager.googleapis.com --project "$PROJECT_ID"

echo "==> Ensuring Artifact Registry repo exists"
gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1 || \
gcloud artifacts repositories create "$AR_REPO" --repository-format=docker \
  --location "$REGION" --project "$PROJECT_ID"

IMG_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"

# ---- Backend ----
echo "==> Building backend image"
gcloud builds submit backend --tag "${IMG_BASE}/api:latest" --project "$PROJECT_ID"

echo "==> Deploying backend (Cloud Run) with Cloud SQL connection"
gcloud run deploy duckpond-api \
  --image "${IMG_BASE}/api:latest" \
  --region "$REGION" --project "$PROJECT_ID" \
  --platform managed --allow-unauthenticated \
  --add-cloudsql-instances "$CONN_NAME" \
  ${VPC_CONNECTOR:+--vpc-connector "$VPC_CONNECTOR"} \
  --set-secrets "DATABASE_URL=duckpond-db-url:latest,JWT_SECRET=duckpond-jwt:latest,ANTHROPIC_API_KEY=duckpond-anthropic:latest" \
  --set-env-vars "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},ALLOWED_HOSTED_DOMAIN=${HOSTED_DOMAIN},ADMIN_EMAILS=${ADMIN_EMAILS},TTS_ENABLED=true,AGENT_CRON_TOKEN=${AGENT_CRON_TOKEN:-change-me}${REDIS_URL:+,REDIS_URL=$REDIS_URL}"

API_URL=$(gcloud run services describe duckpond-api --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')
echo "    API live at: $API_URL"

# ---- Frontend ----
echo "==> Building frontend image (API URL baked in)"
gcloud builds submit frontend \
  --project "$PROJECT_ID" \
  --substitutions "_API_URL=${API_URL},_CLIENT_ID=${GOOGLE_CLIENT_ID}" \
  --config deploy/frontend-build.yaml

echo "==> Deploying frontend (Cloud Run)"
gcloud run deploy duckpond-web \
  --image "${IMG_BASE}/web:latest" \
  --region "$REGION" --project "$PROJECT_ID" \
  --platform managed --allow-unauthenticated

WEB_URL=$(gcloud run services describe duckpond-web --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')

echo "==> Updating backend CORS to allow the web origin"
gcloud run services update duckpond-api --region "$REGION" --project "$PROJECT_ID" \
  --update-env-vars "CORS_ORIGINS=${WEB_URL}"

echo ""
echo "============================================================"
echo " Done."
echo "  Web:  $WEB_URL"
echo "  API:  $API_URL"
echo ""
echo " Final step: add $WEB_URL to your Google OAuth client's"
echo " 'Authorized JavaScript origins' in the Cloud console."
echo "============================================================"
