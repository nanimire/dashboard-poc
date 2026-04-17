const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// --- In-memory sync log (keeps last 10 events) ---
// NOTE: resets on Cloud Run cold start / redeploy. Fine for POC.
// Swap for Firestore when you want persistence.
const MAX_EVENTS = 10;
const syncEvents = [];
let currentSync = null; // tracks an in-flight sync

function addEvent(event) {
  syncEvents.unshift(event);
  if (syncEvents.length > MAX_EVENTS) syncEvents.length = MAX_EVENTS;
}

// --- Middleware: token gate for the trigger endpoint ---
function requireTriggerToken(req, res, next) {
  const token = req.headers['x-trigger-token'];
  if (!token || token !== process.env.TRIGGER_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// --- The fake sync work (replace with real data-mover call later) ---
async function runFakeSync(source) {
  const startedAt = new Date().toISOString();
  currentSync = { source, startedAt, status: 'running' };

  console.log(`[sync] started — source=${source} at=${startedAt}`);

  // Simulate work taking a few seconds
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const finishedAt = new Date().toISOString();
  const message = `Hello world — ${source} sync at ${finishedAt}`;

  console.log(`[sync] ${message}`);

  const event = {
    source, // "manual" | "scheduled"
    status: 'success',
    startedAt,
    finishedAt,
    message,
  };
  addEvent(event);
  currentSync = null;
  return event;
}

// --- API routes ---
app.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello from Cloud Run!',
    timestamp: new Date().toISOString(),
  });
});

// POST /api/trigger-sync   body: { "source": "manual" | "scheduled" }
app.post('/api/trigger-sync', requireTriggerToken, async (req, res) => {
  if (currentSync) {
    return res.status(409).json({ error: 'sync already running', currentSync });
  }
  const source = req.body?.source === 'scheduled' ? 'scheduled' : 'manual';

  // Respond immediately; do the work in the background
  res.status(202).json({
    status: 'started',
    source,
    startedAt: new Date().toISOString(),
  });

  try {
    await runFakeSync(source);
  } catch (err) {
    console.error('[sync] failed:', err);
    addEvent({
      source,
      status: 'failed',
      startedAt: currentSync?.startedAt,
      finishedAt: new Date().toISOString(),
      message: err.message,
    });
    currentSync = null;
  }
});

// GET /api/sync-status — current state + recent history
app.get('/api/sync-status', (req, res) => {
  res.json({
    current: currentSync,
    events: syncEvents,
  });
});

app.get('/healthz', (req, res) => res.send('ok'));

// --- Serve React build ---
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback — any non-API GET returns index.html
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`App listening on ${port}`));
