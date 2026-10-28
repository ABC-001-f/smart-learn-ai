// Detects the optional LearnBond server (server.js, e.g. deployed on Render). When it is there,
// PayPal payouts/refunds become real Sandbox API calls and the AI can run on the server's key.
// When the app is opened as a plain file or from GitHub Pages, everything falls back gracefully.
LB.backend = (() => {
  'use strict';
  const CACHE = 'learnbond:backend';
  const OFFLINE = { online: false, gemini: false, geminiModel: '', paypalPayouts: false, paypalClientId: '', merchantEmail: '' };

  let status = { ...OFFLINE };
  try {
    status = { ...OFFLINE, ...JSON.parse(sessionStorage.getItem(CACHE)) };
  } catch {
    // No cached status yet.
  }

  const ready = !location.protocol.startsWith('http')
    ? Promise.resolve((status = { ...OFFLINE }))
    : fetch('api/config', { cache: 'no-store' })
        .then((res) => (res.ok && (res.headers.get('content-type') || '').includes('json') ? res.json() : null))
        .then((cfg) => (status = cfg ? { ...OFFLINE, ...cfg, online: true } : { ...OFFLINE }))
        .catch(() => (status = { ...OFFLINE }))
        .finally(() => {
          try {
            sessionStorage.setItem(CACHE, JSON.stringify(status));
          } catch {
            // Storage blocked; we'll just re-check next page.
          }
        });

  async function post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((typeof json.error === 'string' ? json.error : json.error?.message) || `Server error ${res.status}`);
    return json;
  }

  return { ready, status: () => status, post };
})();
