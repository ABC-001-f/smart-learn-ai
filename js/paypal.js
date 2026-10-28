// PayPal, Sandbox only (no real money).
// - Checkout runs for real against the PayPal Sandbox through the JavaScript SDK, using only the
//   public client ID (no secret needed in the browser).
// - Payouts and refunds need the app's secret, which must never be put in a browser. When the
//   LearnBond server (server.js) runs with the secret they are real Sandbox API calls; otherwise
//   they are simulated and labelled clearly.
LB.paypal = (() => {
  'use strict';
  const { getSettings } = LB.settings;

  const checkoutIsSandbox = () => Boolean(getSettings().paypalClientId);

  let sdkPromise;
  function loadSdk() {
    sdkPromise ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(getSettings().paypalClientId)}&currency=USD&intent=capture&components=buttons`;
      s.onload = () => resolve(window.paypal);
      s.onerror = () => reject(new Error('Could not load the PayPal SDK. Check your Sandbox client ID in Settings.'));
      document.head.append(s);
    });
    return sdkPromise;
  }

  // Renders Sandbox Smart Buttons. getOrder() returns { amount, description, referenceId } when the
  // buyer clicks; onCaptured() receives the capture details after PayPal confirms payment.
  async function renderButtons(selector, { getOrder, onCaptured, onError, onReady }) {
    const paypal = await loadSdk();
    await paypal
      .Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'pay' },
        createOrder: (data, actions) => {
          const o = getOrder();
          return actions.order.create({
            intent: 'CAPTURE',
            purchase_units: [
              {
                reference_id: o.referenceId,
                custom_id: o.referenceId,
                description: o.description.slice(0, 127),
                amount: { currency_code: 'USD', value: Number(o.amount).toFixed(2) },
              },
            ],
          });
        },
        onApprove: async (data, actions) => {
          const details = await actions.order.capture();
          const capture = details.purchase_units?.[0]?.payments?.captures?.[0];
          if (!capture || capture.status !== 'COMPLETED') throw new Error(`Payment not completed (${capture?.status || details.status}).`);
          await onCaptured({
            orderId: details.id,
            captureId: capture.id,
            amount: Number(capture.amount.value),
            payerEmail: details.payer?.email_address || null,
            sandbox: true,
          });
        },
        onError: (err) => onError(err?.message || 'PayPal checkout failed.'),
      })
      .render(selector);
    onReady?.();
  }

  const simId = (prefix) => `SIM-${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  function simulatedCapture(amount) {
    return { orderId: simId('ORDER'), captureId: simId('CAPTURE'), amount: Number(amount), payerEmail: null, sandbox: false };
  }

  // True when the LearnBond server holds the Sandbox secret, so payouts/refunds are real API calls.
  const payoutsAreReal = () => LB.backend.status().paypalPayouts;

  // Sends money out of the held funds (to the student, or to the study store for agent purchases).
  // Real PayPal Payouts API (Sandbox) through the server when available; otherwise simulated.
  async function payout({ amount, receiver, note, subject, reference }) {
    if (!payoutsAreReal()) return { batchId: simId('PAYOUT'), status: 'SUCCESS', simulated: true };
    return LB.backend.post('api/paypal/payout', { amount, receiver, note, subject, reference });
  }

  // Refunds part of a sponsor's checkout capture. Real only for real Sandbox captures made with the
  // same PayPal app as the server; if PayPal refuses, the refund is recorded as simulated with the reason.
  async function refund({ captureId, amount, note }) {
    if (!payoutsAreReal() || String(captureId).startsWith('SIM-')) return { refundId: simId('REFUND'), status: 'COMPLETED', simulated: true };
    try {
      return await LB.backend.post('api/paypal/refund', { captureId, amount, note });
    } catch (err) {
      return { refundId: simId('REFUND'), status: 'COMPLETED', simulated: true, error: err.message };
    }
  }

  return { checkoutIsSandbox, loadSdk, renderButtons, simulatedCapture, payoutsAreReal, payout, refund };
})();
