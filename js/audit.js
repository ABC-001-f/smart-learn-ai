// Append-only, hash-chained audit log. Every entry commits to the one before it,
// so editing or deleting any past entry breaks the chain and verifyChain() reports it.
LB.audit = (() => {
  'use strict';
  const store = LB.store;

  const GENESIS = '0'.repeat(64);

  async function digest(e) {
    const bytes = new TextEncoder().encode(JSON.stringify([e.seq, e.ts, e.goalId, e.actor, e.action, e.data, e.prevHash]));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Entries are written one at a time so two quick actions can't claim the same sequence number.
  let queue = Promise.resolve();

  function audit(goalId, actor, action, data = {}) {
    queue = queue.then(async () => {
      const log = store.auditLog();
      const prev = log.at(-1);
      const entry = {
        seq: log.length + 1,
        ts: new Date().toISOString(),
        goalId,
        actor,
        action,
        data,
        prevHash: prev ? prev.hash : GENESIS,
      };
      entry.hash = await digest(entry);
      store.appendAudit(entry);
      return entry;
    });
    return queue;
  }

  async function verifyChain() {
    let prev = GENESIS;
    const log = store.auditLog();
    for (const e of log) {
      if (e.prevHash !== prev || (await digest(e)) !== e.hash) return { valid: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { valid: true, length: log.length };
  }

  const entriesFor = (goalId) => store.auditLog().filter((e) => e.goalId === goalId);

  return { audit, verifyChain, entriesFor };
})();
