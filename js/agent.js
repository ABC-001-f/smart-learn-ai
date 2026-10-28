// Study Kit Agent: agentic commerce with a spending mandate.
// The agent reads the learning gaps the Tutor and Examiner found, searches the study store
// (a tool call), and proposes a cart. Code then enforces the sponsor's mandate: real catalog
// prices only, a per-item cap, the remaining kit budget, and an auto-buy limit above which the
// sponsor must approve. Purchases are paid from the held funds to the store's PayPal account.
LB.agent = (() => {
  'use strict';
  const store = LB.store;
  const ai = LB.ai;
  const paypal = LB.paypal;
  const { audit } = LB.audit;
  const { round2, available } = LB.guardrails;
  const { mustGoal } = LB.goals;

  const STORE_NAME = 'LearnBond Study Store (Sandbox)';
  const merchantEmail = () => LB.backend.status().merchantEmail || 'study-store@business.example.com';

  // The study store's catalog. Prices here are the only prices the agent can pay.
  const CATALOG = [
    { sku: 'PP-WAEC-MATH', title: 'WAEC Mathematics past questions 2015–2025 (PDF + solutions)', price: 4, category: 'Past papers', tags: 'waec maths mathematics past questions exam practice algebra quadratic equations', blurb: '10 years of real exam questions with worked solutions.' },
    { sku: 'PP-JAMB-MATH', title: 'JAMB UTME Maths CBT practice pack', price: 5, category: 'Past papers', tags: 'jamb utme maths mathematics cbt practice exam timed', blurb: 'Timed computer-based practice like the real exam.' },
    { sku: 'MOCK-TIMED', title: 'Timed online mock exam with marking', price: 5, category: 'Courses', tags: 'mock exam timed practice speed exam readiness test', blurb: 'Full-length mock, marked within a day.' },
    { sku: 'VID-QUAD', title: 'Video course: quadratic equations in 2 hours', price: 6, category: 'Courses', tags: 'video course quadratic equations factoring completing the square formula discriminant roots', blurb: '12 short lessons, works on low data.' },
    { sku: 'VID-WORDPROB', title: 'Video course: turning word problems into equations', price: 6, category: 'Courses', tags: 'word problems modelling equations application translate real life', blurb: 'Step-by-step method for reading and setting up problems.' },
    { sku: 'CARD-FORMULA', title: 'Formula flashcards: algebra & quadratics (60 cards)', price: 3, category: 'Books', tags: 'flashcards formula algebra quadratic discriminant memorise revision', blurb: 'Pocket cards for quick daily revision.' },
    { sku: 'BOOK-NGM', title: 'New General Mathematics SS2 (textbook)', price: 9, category: 'Books', tags: 'textbook maths mathematics secondary school algebra geometry ngm', blurb: 'The standard secondary-school maths text.' },
    { sku: 'BOOK-ERRORS', title: 'Common maths mistakes and how to fix them (workbook)', price: 4, category: 'Books', tags: 'mistakes errors spot the error sign errors negative numbers workbook', blurb: 'Targets the errors examiners see most.' },
    { sku: 'GRAPH-BOOK', title: 'A4 graph book (40 pages)', price: 1.5, category: 'Supplies', tags: 'graph plotting curves parabola quadratic graph paper', blurb: 'For plotting parabolas and reading roots off graphs.' },
    { sku: 'CALC-SCI', title: 'Scientific calculator (fx-991 class, exam approved)', price: 12, category: 'Tools', tags: 'calculator scientific exam approved arithmetic roots', blurb: 'Exam-approved; solves and checks quadratics.' },
    { sku: 'MATH-SET', title: 'Mathematical set (compass, protractor, rulers)', price: 3, category: 'Supplies', tags: 'geometry set compass protractor construction', blurb: 'Required for geometry and construction questions.' },
    { sku: 'DATA-1GB', title: '1 GB mobile data bundle for tutoring sessions', price: 2.5, category: 'Connectivity', tags: 'data internet bundle connectivity mobile online tutoring', blurb: 'Keeps the AI Tutor and video lessons online.' },
    { sku: 'LAMP-SOLAR', title: 'Solar reading lamp (for study during power cuts)', price: 7, category: 'Tools', tags: 'lamp light power outage study evening solar', blurb: 'Six hours of light from one day of sun.' },
    { sku: 'EAR-MIC', title: 'Earphones with mic (for spoken exams)', price: 6, category: 'Tools', tags: 'earphones headphones microphone voice speaking oral exam', blurb: 'Clearer voice answers for the Examiner.' },
    { sku: 'BOOK-ENG', title: 'English essay & comprehension guide', price: 4, category: 'Books', tags: 'english essay writing comprehension grammar summary', blurb: 'Model essays and comprehension drills.' },
    { sku: 'PP-PHYS', title: 'Physics past questions with solutions', price: 4, category: 'Past papers', tags: 'physics past questions motion electricity waves', blurb: 'Ten years of physics exams, solved.' },
    { sku: 'PY-COURSE', title: 'Intro to Python programming (self-paced)', price: 8, category: 'Courses', tags: 'python programming coding computer science beginner', blurb: 'Hands-on beginner course with exercises.' },
    { sku: 'EXER-BOOKS', title: 'Exercise books (pack of 5)', price: 2, category: 'Supplies', tags: 'exercise books notebook writing practice working', blurb: 'For showing working on every problem.' },
  ];
  const bySku = Object.fromEntries(CATALOG.map((p) => [p.sku, p]));

  const STOP = new Set('the a an and or of to in on for with your you my i is are be how what why this that it can need help me some more'.split(' '));
  const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

  // The agent's "search" tool: keyword relevance over the catalog.
  function search(query, limit = 6) {
    const q = words(query);
    return CATALOG.map((p) => {
      const hay = `${p.title} ${p.tags} ${p.category}`.toLowerCase();
      const score = q.reduce((s, w) => s + (hay.includes(w) ? (p.title.toLowerCase().includes(w) ? 2 : 1) : 0), 0);
      return { p, score };
    })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
      .slice(0, limit)
      .map((r) => r.p);
  }

  // Gaps the agent shops for: the latest Tutor readiness gaps and Examiner concerns for this goal.
  function learningGaps(goal) {
    const gaps = [];
    for (const s of store.sessionsFor(goal.id).slice(-3).reverse()) {
      gaps.push(...(s.readiness?.suspected_gaps || []));
      gaps.push(...(s.verdict?.concerns || []));
      if (s.verdict && !s.verdict.passed && s.verdict.summary) gaps.push(s.verdict.summary);
    }
    const current = goal.milestones.find((m) => m.status === 'active') || goal.milestones.find((m) => m.status !== 'paid');
    if (!gaps.length && current) gaps.push(...current.objectives);
    return { gaps: [...new Set(gaps.map((g) => String(g).trim()).filter(Boolean))].slice(0, 6), milestone: current };
  }

  const mandateOf = (goal) => {
    const kit = goal.kit || { budget: 0, perItemMax: 0, autoBuyLimit: 0, spent: 0, carts: [] };
    const pending = kit.carts.filter((c) => c.status === 'awaiting_approval').reduce((s, c) => s + c.total, 0);
    return { ...kit, pending: round2(pending), budgetLeft: round2(Math.max(0, kit.budget - kit.spent - pending)) };
  };

  // Code, not the model, decides what can be bought.
  function enforceMandate(goal, proposed) {
    const m = mandateOf(goal);
    const owned = new Set(m.carts.filter((c) => c.status === 'bought').flatMap((c) => c.items.map((i) => i.sku)));
    const items = [];
    const rejected = [];
    let total = 0;
    for (const raw of proposed) {
      const p = bySku[String(raw.sku || '').trim().toUpperCase()];
      if (!p) { rejected.push(`${raw.sku}: not in the store catalog`); continue; }
      if (items.some((i) => i.sku === p.sku)) continue;
      if (owned.has(p.sku)) { rejected.push(`${p.title}: already bought`); continue; }
      if (p.price > m.perItemMax) { rejected.push(`${p.title}: $${p.price} is above the $${m.perItemMax} per-item limit`); continue; }
      const qty = Math.min(3, Math.max(1, Math.round(Number(raw.qty) || 1)));
      const line = round2(p.price * qty);
      if (total + line > m.budgetLeft) { rejected.push(`${p.title}: would exceed the $${m.budgetLeft} left in the kit budget`); continue; }
      total = round2(total + line);
      items.push({ sku: p.sku, title: p.title, category: p.category, price: p.price, qty, line, reason: String(raw.reason || '').slice(0, 240) });
    }
    return { items, rejected, total };
  }

  function simulatedPlan(ctx) {
    const queries = [...ctx.gaps.slice(0, 3), ctx.request].filter(Boolean).map((g) => words(g).slice(0, 4).join(' ')).filter(Boolean);
    return { thought: '[Simulated agent] Searching for each learning gap.', queries: queries.length ? queries : [ctx.goal.title] };
  }

  function simulatedPick(ctx, results) {
    const cheapest = [...results].sort((a, b) => a.price - b.price).slice(0, 2);
    return {
      rationale: '[Simulated agent] Picked the cheapest relevant items for the recorded gaps. Add a Gemini key for real reasoning.',
      items: cheapest.map((p) => ({ sku: p.sku, qty: 1, reason: `Matches the gap: ${ctx.gaps[0] || ctx.goal.title}` })),
    };
  }

  async function run(goalId, { request = '', actor = 'sponsor' } = {}) {
    let goal = mustGoal(goalId);
    if (!goal.kit?.budget) throw new Error('This goal has no study kit budget, so the agent cannot buy anything.');
    if (goal.status !== 'active') throw new Error('The agent can shop once the goal is fully funded and active.');
    const mandate = mandateOf(goal);
    if (mandate.budgetLeft < 1) throw new Error('The study kit budget is used up (or waiting on approval).');

    request = String(request || '').trim().slice(0, 300);
    const { gaps, milestone } = learningGaps(goal);
    const ctx = { goal, milestone, gaps, request, mandate };
    const cartId = crypto.randomUUID().slice(0, 8);
    const trace = [];

    await audit(goalId, actor === 'student' ? `student:${goal.studentName}` : `sponsor:${goal.sponsorName}`, 'agent_task_started', { cartId, request: request || '(none)', gaps, mandate: { budgetLeft: mandate.budgetLeft, perItemMax: mandate.perItemMax, autoBuyLimit: mandate.autoBuyLimit } });

    // Step 1: the agent decides what to search for.
    const plan = (await ai.shopperSearch(ctx)) || simulatedPlan(ctx);
    trace.push({ step: 'think', text: plan.thought });

    // Tool call: search the store for each query.
    const results = new Map();
    for (const q of plan.queries.slice(0, 4)) {
      const hits = search(q);
      hits.forEach((p) => results.set(p.sku, p));
      trace.push({ step: 'search', text: `search("${q}") → ${hits.length} result${hits.length === 1 ? '' : 's'}` });
    }
    await audit(goalId, 'agent:shopper', 'store_searched', { cartId, queries: plan.queries, results: [...results.keys()] });

    // Step 2: the agent picks a cart from the results.
    const pick = (await ai.shopperPick(ctx, [...results.values()])) || simulatedPick(ctx, [...results.values()]);
    trace.push({ step: 'decide', text: pick.rationale });

    // Guardrails: the mandate is enforced by code.
    goal = mustGoal(goalId);
    const checked = enforceMandate(goal, pick.items);
    checked.rejected.forEach((r) => trace.push({ step: 'guardrail', text: `Removed: ${r}` }));

    const cart = {
      id: cartId,
      createdAt: new Date().toISOString(),
      requestedBy: actor,
      request,
      gaps,
      rationale: pick.rationale,
      trace,
      items: checked.items,
      total: checked.total,
      rejected: checked.rejected,
      status: checked.items.length ? 'awaiting_approval' : 'empty',
      approvalReasons: [],
    };

    if (cart.items.length && cart.total <= goal.kit.autoBuyLimit) {
      cart.status = 'auto';
    } else if (cart.items.length) {
      cart.approvalReasons.push(`$${cart.total} is above the agent's auto-buy limit of $${goal.kit.autoBuyLimit}.`);
    }
    goal.kit.carts.push(cart);
    store.putGoal(goal);
    await audit(goalId, 'agent:shopper', 'cart_proposed', {
      cartId,
      items: cart.items.map((i) => `${i.qty}× ${i.sku} @ $${i.price}`),
      total: cart.total,
      rationale: cart.rationale,
      removedByGuardrails: cart.rejected,
    });
    await audit(goalId, 'guardrails', 'mandate_check', { cartId, decision: cart.status === 'auto' ? 'auto-buy' : cart.status === 'empty' ? 'nothing to buy' : 'needs_approval', reasons: cart.approvalReasons });

    if (cart.status === 'auto') await checkout(goalId, cartId, 'guardrails:auto-buy');
    return mustGoal(goalId).kit.carts.find((c) => c.id === cartId);
  }

  // Pays the store from the held funds: a PayPal Payout (Sandbox) to the store's account.
  async function checkout(goalId, cartId, actor) {
    const goal = mustGoal(goalId);
    const cart = goal.kit.carts.find((c) => c.id === cartId);
    if (!cart || !['auto', 'awaiting_approval'].includes(cart.status)) throw new Error('This cart cannot be bought.');
    if (goal.kit.spent + cart.total > goal.kit.budget + 0.001) throw new Error('This cart would exceed the study kit budget.');
    if (available(goal) < cart.total) throw new Error('Not enough funds are held for this cart.');

    const receipt = await paypal.payout({
      amount: cart.total,
      receiver: merchantEmail(),
      subject: `LearnBond order ${cart.id}`,
      note: `Study kit for ${goal.studentName}: ${cart.items.map((i) => `${i.qty}x ${i.sku}`).join(', ')}`.slice(0, 900),
      reference: `${goal.id}-kit-${cart.id}`,
    });
    cart.status = 'bought';
    cart.payment = { ...receipt, merchant: STORE_NAME, at: new Date().toISOString() };
    goal.kit.spent = round2(goal.kit.spent + cart.total);
    store.putGoal(goal);
    await audit(goalId, actor, 'kit_purchased', {
      cartId,
      total: cart.total,
      merchant: STORE_NAME,
      payoutBatchId: receipt.batchId,
      via: receipt.simulated ? 'simulated PayPal Payout' : 'PayPal Payouts API (Sandbox)',
      kitSpent: goal.kit.spent,
      kitBudget: goal.kit.budget,
    });
    return cart;
  }

  async function approve(goalId, cartId) {
    const goal = mustGoal(goalId);
    await audit(goalId, `sponsor:${goal.sponsorName}`, 'cart_approved', { cartId });
    return checkout(goalId, cartId, `sponsor:${goal.sponsorName}`);
  }

  async function decline(goalId, cartId) {
    const goal = mustGoal(goalId);
    const cart = goal.kit?.carts.find((c) => c.id === cartId);
    if (!cart || cart.status !== 'awaiting_approval') throw new Error('This cart is not waiting for approval.');
    cart.status = 'declined';
    store.putGoal(goal);
    await audit(goalId, `sponsor:${goal.sponsorName}`, 'cart_declined', { cartId });
  }

  return { CATALOG, STORE_NAME, search, mandateOf, learningGaps, run, approve, decline };
})();
