// Keys live only in this browser's localStorage. They are never committed or sent anywhere
// except to the service they belong to (Gemini key → Google, PayPal client ID → PayPal).
// Shared namespace: each script adds its functions to LB (plain scripts, so the pages also work when opened as files).
var LB = window.LB || {};

LB.settings = (() => {
  'use strict';
  const KEY = 'learnbond:settings';
  const DEFAULT_MODEL = 'gemini-2.5-flash';
  // Public demo Sandbox client ID, used only when neither you nor the server provide one.
  const DEMO_PAYPAL_CLIENT_ID = 'AcONGEWIk1q7B-DRRfSkSyWjC5ZtCXQadbhPwOkolJmNbFgboPlr6sV9UxYaZIIF2JqeDfXClwO9honI';

  function saved() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {}; // Storage blocked (private mode etc.): fall back to simulated mode.
    }
  }

  // Priority: what you saved in Settings → what the LearnBond server provides → demo defaults.
  // (Using the server's client ID keeps checkout and server-side refunds on the same PayPal app.)
  function getSettings() {
    const s = saved();
    const server = LB.backend?.status() || {};
    return {
      geminiKey: s.geminiKey || '',
      geminiModel: s.geminiModel || server.geminiModel || DEFAULT_MODEL,
      paypalClientId: s.paypalClientId || server.paypalClientId || DEMO_PAYPAL_CLIENT_ID,
      paypalClientIdSource: s.paypalClientId ? 'yours' : server.paypalClientId ? 'server' : 'demo',
    };
  }

  function saveSettings(settings) {
    localStorage.setItem(KEY, JSON.stringify({ geminiKey: settings.geminiKey, geminiModel: settings.geminiModel, paypalClientId: settings.paypalClientId }));
  }

  return { DEFAULT_MODEL, getSettings, saveSettings, savedSettings: saved };
})();
