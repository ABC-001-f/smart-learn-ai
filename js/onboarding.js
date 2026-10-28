// First-run setup guide: explains, step by step, how to open Settings and connect the APIs.
// Opens automatically on the first visit and from the "Setup guide" button in the top bar.
LB.onboarding = (() => {
  'use strict';
  const KEY = 'learnbond:onboarding-dismissed';
  const { getSettings, savedSettings } = LB.settings;

  const dismissed = () => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  };
  const setDismissed = (v) => {
    try {
      v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY);
    } catch {
      // Storage blocked: the guide just shows again next time.
    }
  };

  // What is connected right now, for the ✓ / ○ status chips.
  function status() {
    const server = LB.backend.status();
    const saved = savedSettings();
    return {
      gemini: Boolean(saved.geminiKey) || server.gemini,
      geminiFrom: saved.geminiKey ? 'your key' : server.gemini ? 'server key' : '',
      paypal: getSettings().paypalClientIdSource !== 'demo',
      paypalFrom: { yours: 'your client ID', server: 'server client ID', demo: 'shared demo ID' }[getSettings().paypalClientIdSource],
      payouts: server.paypalPayouts,
    };
  }

  const chip = (ok, label, detail) =>
    `<span class="badge ${ok ? 'ok' : 'warn'}">${ok ? '✓' : '○'} ${label}${detail ? ` · ${detail}` : ''}</span>`;

  function checklist() {
    const s = status();
    return `
      <div class="setup-status">
        ${chip(s.gemini, 'Gemini AI', s.gemini ? s.geminiFrom : 'simulated')}
        ${chip(s.paypal, 'PayPal Sandbox checkout', s.paypalFrom)}
        ${chip(s.payouts, 'Real payouts & refunds', s.payouts ? 'server connected' : 'simulated')}
      </div>`;
  }

  const onSettingsPage = () => /settings\.html$/.test(location.pathname);

  function html() {
    const s = status();
    const allSet = s.gemini && s.paypal;
    return `
      <form method="dialog" class="setup-dialog">
        <header>
          <span class="eyebrow"><span class="pulse"></span>Setup guide · about 3 minutes</span>
          <h2>${allSet ? 'You are all set 🎉' : 'Welcome to LearnBond: connect your APIs'}</h2>
          <p class="hint" style="font-size:0.9rem">LearnBond works straight away in <strong>demo mode</strong> (simulated AI and payments).
          To use the <strong>real Gemini AI</strong> and <strong>real PayPal Sandbox</strong>, add your keys in <strong>Settings</strong>. Keys are saved only in this browser.</p>
          ${checklist()}
        </header>

        <ol class="setup-steps">
          <li>
            <strong>Open Settings</strong>
            <p>Click the <span class="kbd">Settings</span> button in the <strong>top-right corner</strong> of any page. Every key below goes into that page.</p>
          </li>
          <li>
            <strong>Add a Gemini API key</strong> <span class="badge info">powers Tutor, Examiner, Planner &amp; shopping agent</span>
            <ol>
              <li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> and sign in with Google.</li>
              <li>Click <b>Create API key</b> and copy it.</li>
              <li>In Settings, paste it into <b>Gemini API key</b>, click <b>Test Gemini</b>, then <b>Save settings</b>.</li>
            </ol>
          </li>
          <li>
            <strong>Add a PayPal Sandbox client ID</strong> <span class="badge info">test money only</span>
            <ol>
              <li>Go to <a href="https://developer.paypal.com/dashboard/applications/sandbox" target="_blank" rel="noopener">developer.paypal.com</a> → <b>Apps &amp; Credentials</b> (make sure the <b>Sandbox</b> toggle is on).</li>
              <li>Click <b>Create App</b> (type: Merchant), then copy the <b>Client ID</b>. <em>Never</em> paste the secret into the browser.</li>
              <li>In Settings, paste it into <b>Sandbox client ID</b> and <b>Save settings</b>.</li>
              <li>To pay at checkout, log in with the <b>Personal</b> account from <b>Testing Tools → Sandbox Accounts</b>.</li>
            </ol>
          </li>
          <li>
            <strong>Optional: real payouts, refunds &amp; agent purchases</strong>
            <p>These need the PayPal <b>secret</b>, which belongs on a server, never in the browser. Copy <code>.env.example</code> to <code>.env</code>, fill in
            <code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code>, then double-click <code>run.bat</code> (Windows) or run <code>./run.sh</code>.
            Or deploy to <b>Render</b> with the included <code>render.yaml</code> (Render asks for the secrets). The app detects the server automatically.</p>
          </li>
        </ol>

        <footer class="row">
          <label class="check"><input type="checkbox" id="setup-dont-show" ${dismissed() ? 'checked' : ''}> Don't show this on start</label>
          <span class="spacer"></span>
          <button class="btn secondary" value="demo">${allSet ? 'Close' : 'Explore in demo mode'}</button>
          ${onSettingsPage() ? '' : '<button class="btn" value="settings">Open Settings →</button>'}
        </footer>
      </form>`;
  }

  function open() {
    let dialog = document.getElementById('setup-guide');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'setup-guide';
      dialog.className = 'modal';
      dialog.setAttribute('aria-label', 'Setup guide');
      document.body.append(dialog);
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close('demo'); // Click on the backdrop closes it.
      });
      dialog.addEventListener('close', () => {
        setDismissed(dialog.querySelector('#setup-dont-show')?.checked);
        if (dialog.returnValue === 'settings') location.href = 'settings.html?from=guide';
      });
    }
    dialog.innerHTML = html();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  // Shows the guide on the first visit, until the user ticks "Don't show this on start".
  async function maybeAutoOpen() {
    await LB.backend.ready;
    if (!dismissed() && !onSettingsPage()) open();
  }

  return { open, maybeAutoOpen, checklist, status };
})();
