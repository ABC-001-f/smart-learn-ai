// Helpers shared by every page.
LB.common = (() => {
  'use strict';
  const ai = LB.ai;
  const paypal = LB.paypal;

  const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const param = (name) => new URLSearchParams(location.search).get(name);

  const fmtTime = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Top-bar mode badges + Setup guide / Settings buttons. Re-renders once the optional server answers.
  function renderModes(el) {
    const draw = () => {
      el.innerHTML = `
        <span class="badge ${paypal.checkoutIsSandbox() ? 'ok' : 'warn'}" title="How sponsors pay">PayPal: ${paypal.checkoutIsSandbox() ? 'Sandbox checkout' : 'Simulated'}</span>
        <span class="badge ${paypal.payoutsAreReal() ? 'ok' : 'warn'}" title="Payouts, refunds and agent purchases">Payouts: ${paypal.payoutsAreReal() ? 'Sandbox API' : 'Simulated'}</span>
        <span class="badge ${ai.isLive() ? 'ok' : 'warn'}" title="AI mode">AI: ${ai.isLive() ? esc(ai.model()) : 'Simulated'}</span>
        <button type="button" class="btn secondary small" data-setup-guide>Setup guide</button>
        <a class="btn secondary small" href="settings.html">Settings</a>`;
      el.querySelector('[data-setup-guide]').addEventListener('click', () => LB.onboarding.open());
    };
    draw();
    LB.backend.ready.then(draw);
    LB.onboarding.maybeAutoOpen();
  }

  const STATUS = {
    awaiting_funds: ['Awaiting funds', 'warn'],
    active: ['Active', 'info'],
    completed: ['Completed', 'ok'],
    closed: ['Closed', ''],
    locked: ['Locked', ''],
    awaiting_approval: ['Needs sponsor approval', 'warn'],
    paid: ['Paid', 'ok'],
    refunded: ['Refunded', ''],
  };

  function statusBadge(status) {
    const [label, cls] = STATUS[status] || [status, ''];
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  // Shows a spinner and a label on the button while the task runs, then puts the button back.
  async function withLoading(btn, label, task) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label)}`;
    try {
      return await task();
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = original;
    }
  }

  let toastTimer;
  function toast(message, isError = false) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('role', 'status');
      document.body.append(el);
    }
    el.className = `toast${isError ? ' error' : ''}`;
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 3500);
  }

  return { money, esc, param, fmtTime, renderModes, statusBadge, withLoading, toast };
})();
