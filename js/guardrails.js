// Rules that sit between the AI's verdict and the money. The AI can recommend a release;
// only these checks (or the sponsor) can let money actually move.
LB.guardrails = (() => {
  'use strict';
  const MIN_QUESTIONS = 3;
  const MAX_QUESTIONS = 5;

  const round2 = (n) => Math.round(n * 100) / 100;

  // Money still held: funded minus what was released, refunded, or spent by the Study Kit Agent.
  const available = (goal) => round2(goal.funded - goal.released - goal.refunded - (goal.kit?.spent || 0));

  const normalize = (s) => String(s).toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

  // The Examiner must quote the student word for word. Quotes that don't appear in the
  // real answers are dropped, so a hallucinated (or manipulated) verdict has no evidence.
  function verifyEvidence(quotes, answers) {
    const corpus = normalize(answers.filter(Boolean).join(' \n '));
    const verified = [];
    const rejected = [];
    for (const q of quotes || []) {
      const n = normalize(q);
      if (n.length >= 8 && corpus.includes(n)) verified.push(String(q).trim());
      else rejected.push(String(q).trim());
    }
    return { verified, rejected };
  }

  function checkRelease(goal, milestone, { integrityFlag, confidence }) {
    const g = goal.guardrails;
    if (available(goal) < milestone.amount) {
      return { decision: 'blocked', reasons: ['Not enough funds are held for this milestone.'] };
    }
    const reasons = [];
    if (milestone.amount > g.autoApproveLimit) {
      reasons.push(`$${milestone.amount} is above the sponsor's auto-release limit of $${g.autoApproveLimit}.`);
    }
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const last24h = goal.releases.filter((r) => Date.parse(r.at) > since).reduce((sum, r) => sum + r.amount, 0);
    if (last24h + milestone.amount > g.dailyCap) {
      reasons.push(`Releasing $${milestone.amount} would pass the $${g.dailyCap} daily cap ($${round2(last24h)} already released today).`);
    }
    if (integrityFlag && confidence < 0.9) {
      reasons.push('Integrity signals (pasted or unusually fast answers) were detected, so a human should check the transcript.');
    }
    return { decision: reasons.length ? 'needs_approval' : 'auto', reasons };
  }

  return { MIN_QUESTIONS, MAX_QUESTIONS, round2, available, verifyEvidence, checkRelease };
})();
