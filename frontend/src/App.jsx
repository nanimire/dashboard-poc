import { useEffect, useState } from 'react';

// POC only: token is baked into the JS bundle and visible in DevTools.
// Acceptable for a closed test. Replace with real auth (Firebase Auth / IAP)
// before making the dashboard public.
const TRIGGER_TOKEN = import.meta.env.VITE_TRIGGER_TOKEN;

export default function App() {
  const [current, setCurrent] = useState(null);
  const [events, setEvents] = useState([]);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState(null);

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/sync-status');
      const data = await r.json();
      setCurrent(data.current);
      setEvents(data.events);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 3000);
    return () => clearInterval(id);
  }, []);

  const triggerSync = async () => {
    setTriggering(true);
    setError(null);
    try {
      const r = await fetch('/api/trigger-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trigger-token': TRIGGER_TOKEN,
        },
        body: JSON.stringify({ source: 'manual' }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTimeout(loadStatus, 500);
    } catch (err) {
      setError(err.message);
    } finally {
      setTriggering(false);
    }
  };

  const busy = triggering || current?.status === 'running';

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <h1>Dashboard — Sync POC</h1>
      <p style={{ color: '#666' }}>
        Proves manual and scheduled sync triggers both reach the backend and get logged.
      </p>

      <button
        onClick={triggerSync}
        disabled={busy}
        style={{
          padding: '0.75rem 1.5rem',
          fontSize: '1rem',
          cursor: busy ? 'not-allowed' : 'pointer',
          background: busy ? '#999' : '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: '0.375rem',
          marginTop: '1rem',
        }}
      >
        {busy ? 'Syncing…' : 'Run Sync Now'}
      </button>

      {error && (
        <p style={{ color: '#dc2626', marginTop: '1rem' }}>Error: {error}</p>
      )}

      {current && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: '#fef3c7',
            borderRadius: '0.375rem',
            border: '1px solid #fcd34d',
          }}
        >
          <strong>In progress:</strong> {current.source} sync started at{' '}
          <code>{current.startedAt}</code>
        </div>
      )}

      <h2 style={{ marginTop: '2rem' }}>Recent sync events</h2>
      {events.length === 0 ? (
        <p style={{ color: '#666' }}>
          No syncs yet. Hit the button above or wait for the daily cron.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Source</th>
              <th style={{ padding: '0.5rem' }}>Status</th>
              <th style={{ padding: '0.5rem' }}>Finished</th>
              <th style={{ padding: '0.5rem' }}>Message</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem' }}>
                  <span
                    style={{
                      padding: '0.15rem 0.5rem',
                      borderRadius: '999px',
                      fontSize: '0.8rem',
                      background: e.source === 'scheduled' ? '#dbeafe' : '#dcfce7',
                    }}
                  >
                    {e.source}
                  </span>
                </td>
                <td style={{ padding: '0.5rem' }}>{e.status}</td>
                <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {e.finishedAt}
                </td>
                <td style={{ padding: '0.5rem' }}>{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
