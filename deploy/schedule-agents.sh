#!/usr/bin/env bash
# ============================================================
# Schedule the nightly self-improvement run via Cloud Scheduler.
# Run AFTER deploy.sh (needs the API URL). Set the same token you
# put in the backend's AGENT_CRON_TOKEN secret/env.
# ============================================================
set -euo pipefail
PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-europe-west2}"
CRON_TOKEN="${AGENT_CRON_TOKEN:?set AGENT_CRON_TOKEN (must match the backend)}"

API_URL=$(gcloud run services describe duckpond-api --region "$REGION" \
  --project "$PROJECT_ID" --format 'value(status.url)')

gcloud services enable cloudscheduler.googleapis.com --project "$PROJECT_ID"

# 02:30 every day, London time
gcloud scheduler jobs create http duckpond-nightly \
  --project "$PROJECT_ID" --location "$REGION" \
  --schedule "30 2 * * *" --time-zone "Europe/London" \
  --uri "${API_URL}/api/agents/cron" --http-method POST \
  --headers "X-Cron-Token=${CRON_TOKEN}" \
  || gcloud scheduler jobs update http duckpond-nightly \
       --project "$PROJECT_ID" --location "$REGION" \
       --schedule "30 2 * * *" --time-zone "Europe/London" \
       --uri "${API_URL}/api/agents/cron" --http-method POST \
       --headers "X-Cron-Token=${CRON_TOKEN}"

echo "Nightly self-improvement run scheduled for 02:30 Europe/London."
