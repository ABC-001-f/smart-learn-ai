// Core LearnBond logic: create goals, take funding, run exams, release and refund money.
LB.goals = (() => {
  'use strict';
  const store = LB.store;
  const paypal = LB.paypal;
  const ai = LB.ai;
  const { audit, entriesFor, verifyChain } = LB.audit;
  const { MIN_QUESTIONS, MAX_QUESTIONS, available, checkRelease, round2, verifyEvidence } = LB.guardrails;

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const shortId = () => crypto.randomUUID().slice(0, 8);
  const now = () => new Date().toISOString();

  function str(value, label, max = 200, { optional = false } = {}) {
    const s = typeof value === 'string' ? value.trim() : '';
    if (!s && !optional) throw new Error(`${label} is required.`);
    if (s.length > max) throw new Error(`${label} must be at most ${max} characters.`);
    return s;
  }

  function num(value, label, { min, max, fallback }) {
    const n = value === undefined || value === '' ? fallback : Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    return n;
  }

  function mustGoal(id) {
    const goal = store.getGoal(id);
    if (!goal) throw new Error('Goal not found. Goals are saved in the browser where they were created.');
    return goal;
  }

  function mustMilestone(goal, milestoneId) {
    const m = goal.milestones.find((x) => x.id === milestoneId);
    if (!m) throw new Error('Milestone not found.');
    return m;
  }

  async function goalView(id) {
    const goal = mustGoal(id);
    return { ...goal, available: available(goal), audit: entriesFor(id).slice().reverse(), chain: await verifyChain() };
  }

  const listGoals = () => store.allGoals();

  async function unlockNext(goal) {
    if (goal.milestones.some((m) => ['active', 'awaiting_approval'].includes(m.status))) return;
    const next = goal.milestones.find((m) => m.status === 'locked');
    if (next) {
      next.status = 'active';
      await audit(goal.id, 'system', 'milestone_unlocked', { milestoneId: next.id, title: next.title });
    } else if (goal.milestones.every((m) => m.status === 'paid')) {
      goal.status = 'completed';
      await audit(goal.id, 'system', 'goal_completed', { released: goal.released });
    }
  }

  /* ---------------- Planning & creation ---------------- */

  function planMilestones(input) {
    return ai.planMilestones({
      title: str(input.title, 'Goal title', 120),
      details: str(input.details, 'Details', 1000, { optional: true }),
      level: str(input.level, 'Student level', 80, { optional: true }) || 'secondary school',
      budget: round2(num(input.budget, 'Budget', { min: 2, max: 10000 })),
      count: Math.round(num(input.count, 'Number of milestones', { min: 1, max: 8, fallback: 3 })),
    });
  }

  async function createGoal(input) {
    const studentEmail = str(input.studentEmail, 'Student PayPal email', 200).toLowerCase();
    if (!EMAIL.test(studentEmail)) throw new Error('Student PayPal email looks invalid.');
    const sponsorName = str(input.sponsorName, 'Sponsor name', 80);
    const deadline = str(input.deadline, 'Deadline', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Date.parse(`${deadline}T23:59:59`) < Date.now()) {
      throw new Error('Deadline must be a future date.');
    }
    if (!Array.isArray(input.milestones) || input.milestones.length < 1 || input.milestones.length > 8) {
      throw new Error('A goal needs 1 to 8 milestones.');
    }
    const milestones = input.milestones.map((m, i) => ({
      id: `m${i + 1}`,
      title: str(m.title, `Milestone ${i + 1} title`, 120),
      objectives: (m.objectives || []).map((o) => String(o).trim().slice(0, 200)).filter(Boolean).slice(0, 5),
      amount: round2(num(m.amount, `Milestone ${i + 1} amount`, { min: 1, max: 10000 })),
      status: 'locked',
      attempts: [],
      proof: null,
      payout: null,
    }));
    milestones.forEach((m, i) => {
      if (!m.objectives.length) throw new Error(`Milestone ${i + 1} needs at least one objective.`);
    });
    const g = input.guardrails || {};
    const k = input.kit || {};
    const kitBudget = round2(num(k.budget, 'Study kit budget', { min: 0, max: 1000, fallback: 0 }));
    const kit = {
      budget: kitBudget,
      perItemMax: round2(num(k.perItemMax, 'Max price per item', { min: 1, max: 1000, fallback: 15 })),
      autoBuyLimit: round2(num(k.autoBuyLimit, 'Agent auto-buy limit', { min: 0, max: 1000, fallback: 8 })),
      spent: 0,
      carts: [],
    };
    const goal = {
      id: shortId(),
      createdAt: now(),
      title: str(input.title, 'Goal title', 120),
      details: str(input.details, 'Details', 1000, { optional: true }),
      studentName: str(input.studentName, 'Student name', 80),
      studentEmail,
      sponsorName,
      deadline,
      status: 'awaiting_funds',
      budget: round2(milestones.reduce((s, m) => s + m.amount, 0) + kitBudget),
      funded: 0,
      released: 0,
      refunded: 0,
      milestones,
      guardrails: {
        minConfidence: num(g.minConfidence, 'Minimum confidence', { min: 0.5, max: 0.99, fallback: 0.75 }),
        autoApproveLimit: round2(num(g.autoApproveLimit, 'Auto-release limit', { min: 0, max: 10000, fallback: 25 })),
        dailyCap: round2(num(g.dailyCap, 'Daily cap', { min: 1, max: 10000, fallback: 50 })),
        maxAttemptsPerDay: 3,
      },
      kit,
      contributions: [],
      releases: [],
      refunds: [],
    };
    store.putGoal(goal);
    await audit(goal.id, `sponsor:${sponsorName}`, 'goal_created', {
      title: goal.title,
      budget: goal.budget,
      student: goal.studentName,
      milestones: milestones.map((m) => ({ id: m.id, title: m.title, amount: m.amount })),
      guardrails: goal.guardrails,
      agentMandate: kitBudget ? { budget: kit.budget, perItemMax: kit.perItemMax, autoBuyLimit: kit.autoBuyLimit } : 'none',
    });
    return goal;
  }

  /* ---------------- Funding ---------------- */

  function validateContribution(goalId, amount) {
    const goal = mustGoal(goalId);
    if (goal.status !== 'awaiting_funds') throw new Error('This goal is already fully funded or closed.');
    const remaining = round2(goal.budget - goal.funded);
    return round2(num(amount, 'Amount', { min: 1, max: remaining }));
  }

  async function recordContribution(goalId, sponsorName, capture) {
    const goal = mustGoal(goalId);
    const contribution = {
      id: shortId(),
      sponsorName: sponsorName || goal.sponsorName,
      payerEmail: capture.payerEmail,
      orderId: capture.orderId,
      captureId: capture.captureId,
      amount: round2(capture.amount),
      sandbox: capture.sandbox,
      refunded: 0,
      at: now(),
    };
    goal.contributions.push(contribution);
    goal.funded = round2(goal.funded + contribution.amount);
    await audit(goal.id, `sponsor:${contribution.sponsorName}`, 'funds_captured', {
      amount: contribution.amount,
      via: capture.sandbox ? 'PayPal Sandbox checkout' : 'simulated checkout',
      orderId: contribution.orderId,
      captureId: contribution.captureId,
      totalFunded: goal.funded,
    });
    if (goal.funded >= goal.budget) {
      goal.status = 'active';
      await audit(goal.id, 'system', 'goal_activated', { funded: goal.funded, heldUntilEarned: available(goal) });
      await unlockNext(goal);
    }
    store.putGoal(goal);
  }

  /* ---------------- Tutor ---------------- */

  function sanitizeChat(messages, { allowEmpty = false } = {}) {
    const clean = [];
    for (const m of (messages || []).slice(-30)) {
      if (!['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string' || !m.content.trim()) continue;
      const content = m.content.trim().slice(0, 4000);
      if (clean.length && clean.at(-1).role === m.role) clean.at(-1).content += `\n\n${content}`;
      else clean.push({ role: m.role, content });
    }
    while (clean.length && clean[0].role !== 'user') clean.shift();
    if (!allowEmpty && (!clean.length || clean.at(-1).role !== 'user')) throw new Error('Send a message to the Tutor first.');
    return clean;
  }

  async function tutorReply(goalId, milestoneId, messages) {
    const goal = mustGoal(goalId);
    const milestone = mustMilestone(goal, milestoneId);
    if (milestone.status !== 'active') throw new Error('This milestone is not open for study right now.');
    return ai.tutorReply({ goal, milestone, messages: sanitizeChat(messages) });
  }

  /* ---------------- Examiner ---------------- */

  function cleanSignals(raw, answer) {
    const typingSeconds = Math.max(0, Number(raw?.typingSeconds) || 0);
    const voice = Boolean(raw?.voice);
    const pastedChars = Math.max(0, Math.round(Number(raw?.pastedChars) || 0));
    const charsPerSecond = typingSeconds > 0 ? round2(answer.length / typingSeconds) : null;
    return {
      pasted: pastedChars > 20,
      pastedChars,
      voice,
      typingSeconds: round2(typingSeconds),
      charsPerSecond,
      fast: !voice && answer.length > 80 && charsPerSecond !== null && charsPerSecond > 15,
    };
  }

  async function startExam(goalId, milestoneId, tutorMessages) {
    let goal = mustGoal(goalId);
    if (goal.status !== 'active') throw new Error('This goal is not active yet. It must be fully funded first.');
    let milestone = mustMilestone(goal, milestoneId);
    if (milestone.status !== 'active') throw new Error(`This milestone is ${milestone.status.replace('_', ' ')}.`);
    const since = Date.now() - 24 * 60 * 60 * 1000;
    if (milestone.attempts.filter((a) => Date.parse(a.startedAt) > since).length >= goal.guardrails.maxAttemptsPerDay) {
      throw new Error(`Attempt limit reached (${goal.guardrails.maxAttemptsPerDay} per day). Keep studying with the Tutor and try again tomorrow.`);
    }

    const readiness = await ai.readinessClaim({ goal, milestone, transcript: sanitizeChat(tutorMessages, { allowEmpty: true }) });
    const first = await ai.examinerStep({ goal, milestone, readiness, turns: [], phase: 'open' });
    const question = first.question?.trim() || `In your own words: ${milestone.objectives[0]}`;

    const session = {
      id: crypto.randomUUID(),
      goalId,
      milestoneId,
      readiness,
      turns: [{ question, answer: null, signals: null }],
      status: 'open',
      startedAt: now(),
    };
    store.putSession(session);

    goal = mustGoal(goalId);
    milestone = mustMilestone(goal, milestoneId);
    milestone.attempts.push({ sessionId: session.id, startedAt: session.startedAt, result: 'in_progress' });
    store.putGoal(goal);
    await audit(goalId, 'agent:tutor', 'readiness_claim', { milestoneId, claim: readiness.claim, suspectedGaps: readiness.suspected_gaps });
    await audit(goalId, 'agent:examiner', 'exam_started', { milestoneId, sessionId: session.id });
    return { sessionId: session.id, readiness, remark: first.remark, question, asked: 1, max: MAX_QUESTIONS };
  }

  async function answerExam(sessionId, answerText, rawSignals) {
    const session = store.getSession(sessionId);
    if (!session) throw new Error('Exam session not found.');
    if (session.status !== 'open') throw new Error('This exam is already finished.');
    let goal = mustGoal(session.goalId);
    let milestone = mustMilestone(goal, session.milestoneId);
    if (milestone.status !== 'active') throw new Error('This milestone is no longer open.');

    const answer = str(answerText, 'Answer', 4000);
    const turn = session.turns.at(-1);
    turn.answer = answer;
    turn.signals = cleanSignals(rawSignals, answer);

    const answered = session.turns.length;
    const phase = answered < MIN_QUESTIONS ? 'ask' : answered >= MAX_QUESTIONS ? 'decide' : 'either';
    const step = await ai.examinerStep({ goal, milestone, readiness: session.readiness, turns: session.turns, phase });

    const decide = phase === 'decide' || (phase === 'either' && step.action === 'verdict');
    if (!decide) {
      const question = step.question?.trim() || 'Explain the main idea of this milestone in your own words, with a fresh example.';
      session.turns.push({ question, answer: null, signals: null });
      store.putSession(session);
      return { done: false, remark: step.remark, question, asked: session.turns.length, max: MAX_QUESTIONS };
    }

    goal = mustGoal(session.goalId);
    milestone = mustMilestone(goal, session.milestoneId);
    return finishExam(goal, milestone, session, step);
  }

  async function finishExam(goal, milestone, session, step) {
    const g = goal.guardrails;
    const evidence = verifyEvidence(step.evidence_quotes, session.turns.map((t) => t.answer));
    const overrides = [];
    let passed = Boolean(step.passed);
    if (passed && step.confidence < g.minConfidence) {
      passed = false;
      overrides.push(`Confidence ${Math.round(step.confidence * 100)}% is below the sponsor's ${Math.round(g.minConfidence * 100)}% threshold.`);
    }
    if (passed && evidence.verified.length === 0) {
      passed = false;
      overrides.push("None of the Examiner's evidence quotes match the student's real answers, so the verdict is void.");
    }

    const verdict = {
      passed,
      confidence: step.confidence,
      summary: step.summary,
      remark: step.remark,
      evidence: evidence.verified,
      concerns: step.concerns,
      overrides,
    };
    session.status = 'closed';
    session.verdict = verdict;
    store.putSession(session);

    const attempt = milestone.attempts.find((a) => a.sessionId === session.id);
    if (attempt) Object.assign(attempt, { result: passed ? 'passed' : 'not_yet', confidence: step.confidence });
    await audit(goal.id, 'agent:examiner', passed ? 'mastery_verified' : 'mastery_not_verified', {
      milestoneId: milestone.id,
      confidence: step.confidence,
      summary: step.summary,
      evidence: evidence.verified,
      rejectedQuotes: evidence.rejected.length,
      overrides,
    });

    if (!passed) {
      store.putGoal(goal);
      return { done: true, verdict, release: null };
    }

    milestone.proof = { summary: step.summary, evidence: evidence.verified, confidence: step.confidence, concerns: step.concerns, verifiedAt: now() };
    const integrityFlag = session.turns.some((t) => t.signals?.pasted || t.signals?.fast);
    const check = checkRelease(goal, milestone, { integrityFlag, confidence: step.confidence });
    await audit(goal.id, 'guardrails', 'release_check', { milestoneId: milestone.id, decision: check.decision, reasons: check.reasons });

    const release = { decision: check.decision, reasons: check.reasons };
    if (check.decision === 'auto') {
      try {
        release.payout = await releaseFunds(goal, milestone, 'guardrails:auto-release');
      } catch (err) {
        // PayPal refused the payout: keep the proof and let the sponsor retry from the dashboard.
        release.decision = 'needs_approval';
        release.reasons = [`PayPal payout failed (${err.message}). The sponsor can retry.`];
        milestone.status = 'awaiting_approval';
        milestone.approvalReasons = release.reasons;
        await audit(goal.id, 'paypal', 'payout_failed', { milestoneId: milestone.id, error: err.message });
      }
    } else {
      milestone.status = 'awaiting_approval';
      milestone.approvalReasons = check.reasons;
    }
    store.putGoal(goal);
    return { done: true, verdict, release };
  }

  /* ---------------- Release & refund ---------------- */

  async function releaseFunds(goal, milestone, actor) {
    const payout = await paypal.payout({
      amount: milestone.amount,
      receiver: goal.studentEmail,
      subject: `LearnBond: you earned ${milestone.amount} USD`,
      note: `Mastery verified for "${milestone.title}" (${goal.title}). Sponsored by ${goal.sponsorName}.`,
      reference: `${goal.id}-${milestone.id}`,
    });
    milestone.payout = { ...payout, amount: milestone.amount, receiver: goal.studentEmail, at: now() };
    milestone.status = 'paid';
    delete milestone.approvalReasons;
    goal.released = round2(goal.released + milestone.amount);
    goal.releases.push({ milestoneId: milestone.id, amount: milestone.amount, at: milestone.payout.at });
    await audit(goal.id, actor, 'payout_sent', {
      milestoneId: milestone.id,
      amount: milestone.amount,
      receiver: goal.studentEmail,
      payoutBatchId: payout.batchId,
      payoutStatus: payout.status,
      via: payout.simulated ? 'simulated PayPal Payout' : 'PayPal Payouts API (Sandbox)',
    });
    await unlockNext(goal);
    return milestone.payout;
  }

  async function approveMilestone(goalId, milestoneId) {
    const goal = mustGoal(goalId);
    const milestone = mustMilestone(goal, milestoneId);
    if (milestone.status !== 'awaiting_approval' || !milestone.proof) throw new Error('This milestone is not waiting for approval.');
    if (available(goal) < milestone.amount) throw new Error('Not enough funds held for this milestone.');
    await audit(goalId, `sponsor:${goal.sponsorName}`, 'release_approved', { milestoneId });
    await releaseFunds(goal, milestone, `sponsor:${goal.sponsorName}`);
    store.putGoal(goal);
  }

  async function sendBackMilestone(goalId, milestoneId) {
    const goal = mustGoal(goalId);
    const milestone = mustMilestone(goal, milestoneId);
    if (milestone.status !== 'awaiting_approval') throw new Error('This milestone is not waiting for approval.');
    milestone.status = 'active';
    milestone.proof = null;
    delete milestone.approvalReasons;
    store.putGoal(goal);
    await audit(goalId, `sponsor:${goal.sponsorName}`, 'release_rejected', { milestoneId, note: 'Sponsor asked for another attempt.' });
  }

  async function closeAndRefund(goalId, actor, reason) {
    const goal = mustGoal(goalId);
    const wasCompleted = goal.status === 'completed';
    if (goal.status === 'closed' || (wasCompleted && available(goal) <= 0)) throw new Error('This goal is already closed.');

    let due = available(goal);
    for (const c of [...goal.contributions].reverse()) {
      if (due <= 0) break;
      const amount = round2(Math.min(c.amount - c.refunded, due));
      if (amount <= 0) continue;
      const refund = await paypal.refund({ captureId: c.captureId, amount, note: `Unearned LearnBond funds for "${goal.title}" returned. ${reason}.` });
      c.refunded = round2(c.refunded + amount);
      goal.refunded = round2(goal.refunded + amount);
      due = round2(due - amount);
      goal.refunds.push({ contributionId: c.id, to: c.sponsorName, amount, refundId: refund.refundId, simulated: refund.simulated, at: now() });
      await audit(goalId, actor, 'refund_sent', {
        to: c.sponsorName,
        amount,
        captureId: c.captureId,
        refundId: refund.refundId,
        via: refund.simulated ? 'simulated PayPal Refund' : 'PayPal Refunds API (Sandbox)',
        liveRefundError: refund.error,
        reason,
      });
    }

    for (const m of goal.milestones) {
      if (m.status !== 'paid') m.status = 'refunded';
    }
    for (const cart of goal.kit?.carts || []) {
      if (cart.status === 'awaiting_approval') cart.status = 'declined';
    }
    goal.status = wasCompleted ? 'completed' : 'closed';
    goal.closedReason = reason;
    store.putGoal(goal);
    await audit(goalId, actor, 'goal_closed', { reason, released: goal.released, refunded: goal.refunded });
  }

  // Goals past their deadline close and refund unearned money whenever the app is opened.
  async function sweepDeadlines() {
    for (const goal of store.allGoals()) {
      if (!['active', 'awaiting_funds'].includes(goal.status)) continue;
      if (Date.parse(`${goal.deadline}T23:59:59`) > Date.now()) continue;
      await closeAndRefund(goal.id, 'system:deadline', 'Deadline passed').catch((err) => console.error(err));
    }
  }

  return { mustGoal, goalView, listGoals, planMilestones, createGoal, validateContribution, recordContribution, tutorReply, startExam, answerExam, approveMilestone, sendBackMilestone, closeAndRefund, sweepDeadlines };
})();
