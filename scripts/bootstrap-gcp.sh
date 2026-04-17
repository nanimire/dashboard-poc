#!/usr/bin/env bash
# One-time GCP setup for the dashboard POC.
# Run this ONCE after creating your GCP project.
# Requires: gcloud CLI installed and logged in (`gcloud auth login`).

set -euo pipefail

# ---- EDIT THESE ----
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
# --------------------

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID is not set."
  echo "Usage: PROJECT_ID=your-project-id ./scripts/bootstrap-gcp.sh"
  exit 1
fi

echo "==> Using project: $PROJECT_ID"
echo "==> Using region:  $REGION"
gcloud config set project "$PROJECT_ID"

echo "==> Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com

echo "==> Creating Artifact Registry repo (dashboard-images) if needed..."
if ! gcloud artifacts repositories describe dashboard-images --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create dashboard-images \
    --repository-format=docker \
    --location="$REGION"
else
  echo "    already exists, skipping."
fi

echo "==> Creating GitHub deployer service account if needed..."
SA_EMAIL="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create github-deployer \
    --display-name="GitHub Actions Deployer"
else
  echo "    already exists, skipping."
fi

echo "==> Granting IAM roles to $SA_EMAIL..."
for role in \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountUser \
  roles/storage.admin \
  roles/secretmanager.admin
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
done

echo "==> Generating a TRIGGER_TOKEN..."
TRIGGER_TOKEN="$(openssl rand -hex 32)"

echo "==> Creating/updating TRIGGER_TOKEN secret..."
if gcloud secrets describe TRIGGER_TOKEN >/dev/null 2>&1; then
  echo -n "$TRIGGER_TOKEN" | gcloud secrets versions add TRIGGER_TOKEN --data-file=-
else
  echo -n "$TRIGGER_TOKEN" | gcloud secrets create TRIGGER_TOKEN --data-file=-
fi

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
COMPUTE_SA="${PROJECT_NUMBER}[email protected]"

echo "==> Granting Cloud Run default SA access to the secret..."
gcloud secrets add-iam-policy-binding TRIGGER_TOKEN \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

echo "==> Creating service-account JSON key for GitHub Actions..."
gcloud iam service-accounts keys create github-sa-key.json \
  --iam-account="$SA_EMAIL"

cat <<EOF

============================================================
 ✅ GCP bootstrap complete.

 Next: add these GitHub secrets to your repo
 (Settings → Secrets and variables → Actions → New repository secret)

   GCP_PROJECT     = $PROJECT_ID
   GCP_SA_KEY      = (paste the FULL contents of github-sa-key.json)
   TRIGGER_TOKEN   = $TRIGGER_TOKEN
   BACKEND_URL     = (fill in after first deploy — the Cloud Run URL)

 For local dev, create frontend/.env with:

   VITE_TRIGGER_TOKEN=$TRIGGER_TOKEN

 ⚠  github-sa-key.json contains a credential. After you paste it
    into GitHub, delete it:

      rm github-sa-key.json

============================================================
EOF
