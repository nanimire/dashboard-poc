# Dashboard POC — React + Express on Cloud Run

A proof-of-concept dashboard that proves the full deploy + scheduling pipeline:

- **React frontend** served by the same Cloud Run container as the backend
- **Express backend** with a `/api/trigger-sync` endpoint protected by a shared token
- **Manual trigger** — a "Run Sync Now" button in the dashboard
- **Scheduled trigger** — a GitHub Actions cron workflow that hits the same endpoint daily
- **CI/CD** — pushes to `main` auto-deploy via GitHub Actions

The "sync" itself is a stub that logs `Hello world — <source> sync at <timestamp>`. Swap `runFakeSync` in `backend/index.js` for a real API call when you're ready.

## Architecture

```
┌────────────────────────────────────┐
│  React dashboard                   │
│  - "Run Sync Now" button           │──────┐
│  - Shows last 10 sync events       │      │
└────────────────────────────────────┘      │
                   ▲                         ▼
                   │ polls /api/sync-status  POST /api/trigger-sync
                   │                         │
┌──────────────────┴─────────────────────────┴───────┐
│  Cloud Run: dashboard-app                          │
│  - Express serves both React build and /api/*     │
│  - In-memory log of last 10 events                 │
│  - TRIGGER_TOKEN from Secret Manager               │
└──────────────────┬─────────────────────────────────┘
                   ▲
                   │ daily curl with token
                   │
        ┌──────────┴──────────┐
        │  GitHub Actions cron │
        └──────────────────────┘
```

## Project layout

```
.
├── frontend/              React app (Vite)
│   ├── src/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example
├── backend/               Express API + static file server
│   ├── index.js
│   └── package.json
├── .github/workflows/
│   ├── deploy.yml         Builds + deploys on push to main
│   └── daily-sync.yml     Scheduled trigger (02:00 UTC daily)
├── scripts/
│   └── bootstrap-gcp.sh   One-time GCP setup
├── Dockerfile             Multi-stage: builds React, copies into backend
├── cloudbuild.yaml        Cloud Build config (passes VITE_TRIGGER_TOKEN as build-arg)
├── .dockerignore
├── .gitignore
└── README.md
```

---

## Deploy: step by step

### Prerequisites

- GCP project with billing enabled
- Owner or Editor role on the project
- `gcloud` CLI installed and authenticated (`gcloud auth login`) — or use Cloud Shell
- GitHub repo (private is fine)
- Node.js 20+ locally (for testing before deploy)

### Step 1 — Run the bootstrap script

This enables APIs, creates the Artifact Registry repo, creates a service account for GitHub, generates a `TRIGGER_TOKEN`, and stores it in Secret Manager.

```bash
PROJECT_ID=your-project-id ./scripts/bootstrap-gcp.sh
```

When it finishes it prints the values you need to paste into GitHub secrets.

### Step 2 — Add GitHub secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value |
|---|---|
| `GCP_PROJECT` | your project ID |
| `GCP_SA_KEY` | full JSON contents of `github-sa-key.json` |
| `TRIGGER_TOKEN` | the token printed by the bootstrap script |
| `BACKEND_URL` | *fill in after Step 4* — your Cloud Run URL |

After pasting `GCP_SA_KEY`, delete the local file:

```bash
rm github-sa-key.json
```

### Step 3 — Test locally (optional but recommended)

Create `frontend/.env` from the example and paste in the token:

```bash
cp frontend/.env.example frontend/.env
# edit frontend/.env and set VITE_TRIGGER_TOKEN to the same value
```

In two terminals:

```bash
# Terminal 1
cd backend
npm install
TRIGGER_TOKEN=the-same-token-value npm start

# Terminal 2
cd frontend
npm install
npm run dev
```

Open the Vite URL (usually `http://localhost:5173`), click **Run Sync Now**, and you should see a row appear in the table.

### Step 4 — First deploy

Push to `main`:

```bash
git init
git add .
git commit -m "Initial dashboard POC"
git branch -M main
git remote add origin [email protected]:YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Watch the **Actions** tab. The `Deploy to Cloud Run` workflow takes ~3 minutes. When it's green, the final step prints the Cloud Run URL.

Copy that URL and add it as the `BACKEND_URL` GitHub secret.

### Step 5 — Verify manual trigger

1. Open the Cloud Run URL in your browser
2. Click **Run Sync Now**
3. A yellow "In progress" banner appears, then disappears after ~3 seconds
4. A new row appears in the table with source `manual` and `Hello world — manual sync at <timestamp>`

### Step 6 — Verify scheduled trigger

Go to **Actions → Daily Sync Trigger → Run workflow** (top right, dropdown). Click **Run workflow**. This simulates what the nightly cron will do.

Refresh the dashboard in a few seconds — a new row appears with source `scheduled`.

To check Cloud Run logs:

```bash
gcloud run services logs read dashboard-app --region=us-central1 --limit=20
```

You should see:
```
[sync] started — source=manual at=2026-04-17T...
[sync] Hello world — manual sync at 2026-04-17T...
[sync] started — source=scheduled at=2026-04-17T...
[sync] Hello world — scheduled sync at 2026-04-17T...
```

That's the full pipeline working end-to-end. ✅

---

## What to watch for

**401 unauthorized on trigger** — the `TRIGGER_TOKEN` values don't match across the three places that use it: Secret Manager (bound into Cloud Run), GitHub secret (used by cron workflow + baked into the React build), and local `.env` (for dev only). Re-run the bootstrap script to regenerate and update them together.

**409 already running** — previous sync got stuck (usually from a killed cold-start container). Redeploy to clear the in-memory flag.

**Cron didn't fire at 02:00 UTC** — GitHub's scheduled workflows can be delayed 15+ min during heavy load, and cron is disabled on repos with no activity for 60 days. For ongoing use, push any small commit periodically or use `workflow_dispatch` to verify it still works.

**Trigger token is visible in the browser** — yes, because Vite bakes `VITE_*` vars into the JS bundle at build time. That's acceptable for a closed POC. Before going public, add real auth (Firebase Auth or IAP) and have the backend verify a user ID token instead of a static shared secret.

**In-memory events disappear** — Cloud Run scales to zero when idle, so the `syncEvents` array resets. For persistence, swap it for a Firestore collection (~5 min of changes).

---

## Swapping the fake sync for real work

In `backend/index.js`, replace the body of `runFakeSync` with the actual API call:

```js
async function runFakeSync(source) {
  const startedAt = new Date().toISOString();
  currentSync = { source, startedAt, status: 'running' };

  const response = await fetch(process.env.DATA_MOVER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DATA_MOVER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ /* payload */ }),
  });
  if (!response.ok) throw new Error(`Data mover returned ${response.status}`);
  const data = await response.json();

  const finishedAt = new Date().toISOString();
  const message = `Moved ${data.rows ?? 'n/a'} rows at ${finishedAt}`;
  addEvent({ source, status: 'success', startedAt, finishedAt, message });
  currentSync = null;
}
```

Store the new secrets in Secret Manager and bind them on the Cloud Run service (add them to `--set-secrets` in `.github/workflows/deploy.yml`).
