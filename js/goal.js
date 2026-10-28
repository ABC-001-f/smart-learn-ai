(() => {
  'use strict';
  const { money, esc, param, fmtTime, renderModes, statusBadge, toast, withLoading } = LB.common;
  const goals = LB.goals;
  const paypal = LB.paypal;
  const agent = LB.agent;
  const grids = LB.grids;
  const { onExternalChange } = LB.store;
  let ledgerGrid = null;
  let auditGrid = null;

  const id = param('id');
  const $ = (sel) => document.getElementById(sel);
  let goal = null;
  let lastSnapshot = '';
  let paypalRendered = false;

  renderModes($('modes'));

  const studentUrl = new URL(`learn.html?id=${encodeURIComponent(id)}`, location.href).href;
  $('student-link').href = studentUrl;
  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(studentUrl);
      toast('Student link copied. Open it in this same browser.');
    } catch {
      toast(studentUrl);
    }
  });

  async function load() {
    try {
      await goals.sweepDeadlines();
      const next = await goals.goalView(id);
      const snapshot = JSON.stringify(next);
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        goal = next;
        render();
      }
    } catch (err) {
      $('loading').classList.remove('loading');
      $('loading').textContent = err.message;
    }
  }

  function render() {
    $('loading').classList.add('hidden');
    $('app').classList.remove('hidden');
    document.title = `${goal.title} · LearnBond`;
    $('title').textContent = goal.title;
    $('status').innerHTML = statusBadge(goal.status);
    $('subtitle').textContent = `Sponsored by ${goal.sponsorName} for ${goal.studentName} (${goal.studentEmail}) · deadline ${goal.deadline}`;

    $('stats').innerHTML = [
      ['Budget', goal.budget, ''],
      ['Funded via PayPal', goal.funded, ''],
      ['Held until earned', goal.available, ''],
      ['Released to student', goal.released, 'money'],
      ...(goal.kit?.budget ? [['Agent spent on study kit', goal.kit.spent, '']] : []),
      ['Refunded to sponsors', goal.refunded, ''],
    ]
      .map(([label, v, cls]) => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${money(v)}</div></div>`)
      .join('');

    const pct = (v) => (goal.budget ? (v / goal.budget) * 100 : 0);
    $('money-bar').innerHTML = `<span class="released" style="width:${pct(goal.released)}%"></span><span class="spent" style="width:${pct(goal.kit?.spent || 0)}%"></span><span class="held" style="width:${pct(goal.available)}%"></span><span class="refunded" style="width:${pct(goal.refunded)}%"></span>`;

    renderFunding();
    renderMilestones();
    renderAgent();
    renderLedger();
    renderGuardrails();
    renderAudit();
    const leftover = goal.status === 'completed' && goal.available > 0;
    $('close-btn').disabled = goal.status === 'closed' || (goal.status === 'completed' && !leftover);
    $('close-btn').textContent = leftover ? `Refund unspent ${money(goal.available)} to sponsors` : 'Close goal & refund unearned funds';
  }

  /* ---------------- Funding ---------------- */

  function renderFunding() {
    const remaining = Math.round((goal.budget - goal.funded) * 100) / 100;
    const open = goal.status === 'awaiting_funds' && remaining > 0;
    $('fund-card').classList.toggle('hidden', !open);
    if (!open) return;

    $('fund-hint').textContent = `${money(remaining)} still needed. Relatives can split it: each contribution is a separate PayPal payment, and anything not earned is refunded to the people who paid.`;
    const amountInput = $('fund-amount');
    amountInput.max = remaining;
    if (!amountInput.value || Number(amountInput.value) > remaining) amountInput.value = remaining;
    if (!$('fund-name').value) $('fund-name').value = goal.sponsorName;

    if (paypalRendered) return;
    paypalRendered = true;

    if (!paypal.checkoutIsSandbox()) {
      const btn = $('sim-pay');
      btn.classList.remove('hidden');
      btn.onclick = async () => {
        try {
          await withLoading(btn, 'Processing payment…', async () => {
            const amount = goals.validateContribution(id, amountInput.value);
            await goals.recordContribution(id, $('fund-name').value, paypal.simulatedCapture(amount));
          });
          toast('Simulated payment recorded.');
          await load();
        } catch (err) {
          toast(err.message, true);
        }
      };
      return;
    }

    $('paypal-buttons').innerHTML = '<div class="hint loading">Loading PayPal checkout…</div>';
    paypal
      .renderButtons('#paypal-buttons', {
        onReady: () => $('paypal-buttons').querySelector('.loading')?.remove(),
        getOrder: () => ({
          amount: goals.validateContribution(id, amountInput.value),
          description: `LearnBond: ${goal.title}`,
          referenceId: id,
        }),
        onCaptured: async (capture) => {
          await goals.recordContribution(id, $('fund-name').value, capture);
          toast('Sandbox payment captured. The funds are held until mastery is verified.');
          await load();
        },
        onError: (message) => toast(message, true),
      })
      .catch((err) => {
        $('paypal-buttons').innerHTML = '';
        toast(err.message, true);
      });
  }

  /* ---------------- Milestones ---------------- */

  function confidenceBar(c) {
    const pct = Math.round(c * 100);
    return `<span class="confidence">Examiner confidence <span class="bar"><span style="width:${pct}%"></span></span> <strong>${pct}%</strong></span>`;
  }

  function renderMilestones() {
    $('milestones').innerHTML = goal.milestones
      .map((m, i) => {
        const attempts = m.attempts.filter((a) => a.result !== 'in_progress');
        const receipt = m.proof
          ? `
          <div class="receipt">
            <div class="row"><strong>Proof-of-learning receipt</strong><span class="spacer"></span>${confidenceBar(m.proof.confidence)}</div>
            <p style="margin:8px 0">${esc(m.proof.summary)}</p>
            ${m.proof.evidence.map((q) => `<div class="quote">“${esc(q)}”<span class="hint"> (${esc(goal.studentName)}, verified against transcript)</span></div>`).join('')}
            ${m.proof.concerns.length ? `<p class="hint" style="margin-top:8px">Examiner notes: ${m.proof.concerns.map(esc).join(' · ')}</p>` : ''}
            ${m.payout ? `<p class="hint" style="margin-top:8px">Payout <code class="mono">${esc(m.payout.batchId)}</code> · ${esc(m.payout.status)} · ${fmtTime(m.payout.at)}${m.payout.simulated ? ' · simulated' : ' · PayPal Payouts API (Sandbox)'}</p>` : ''}
          </div>`
          : '';
        const approval =
          m.status === 'awaiting_approval'
            ? `
          <div class="approval">
            <strong>The AI verified mastery, but the guardrails need your OK before releasing ${money(m.amount)}:</strong>
            <ul>${(m.approvalReasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
            <div class="row">
              <button class="btn money small" data-approve="${m.id}">Approve &amp; release ${money(m.amount)}</button>
              <button class="btn secondary small" data-sendback="${m.id}">Send back for another attempt</button>
            </div>
          </div>`
            : '';
        return `
          <article class="milestone ${m.status}">
            <header>
              <h3>${i + 1}. ${esc(m.title)}</h3>
              <span class="amount">${money(m.amount)}</span>
              ${statusBadge(m.status)}
            </header>
            <ul class="objectives">${m.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
            ${attempts.length ? `<p class="hint" style="margin:8px 0 0">Exam attempts: ${attempts.map((a) => `${a.result === 'passed' ? '✅' : '❌'} ${Math.round((a.confidence || 0) * 100)}%`).join(' · ')}</p>` : ''}
            ${approval}
            ${receipt}
          </article>`;
      })
      .join('');

    $('milestones').querySelectorAll('[data-approve]').forEach((btn) =>
      btn.addEventListener('click', () => act(btn, 'Releasing payout…', () => goals.approveMilestone(id, btn.dataset.approve), 'Payout released.')),
    );
    $('milestones').querySelectorAll('[data-sendback]').forEach((btn) =>
      btn.addEventListener('click', () => act(btn, 'Sending back…', () => goals.sendBackMilestone(id, btn.dataset.sendback), 'Sent back to the student.')),
    );
  }

  async function act(btn, label, action, okMessage) {
    try {
      await withLoading(btn, label, action);
      toast(okMessage);
    } catch (err) {
      toast(err.message, true);
    }
    await load();
  }

  /* ---------------- Study Kit Agent ---------------- */

  const CART_STATUS = { auto: ['Buying…', 'info'], bought: ['Bought', 'ok'], awaiting_approval: ['Needs your approval', 'warn'], declined: ['Declined', ''], empty: ['Nothing to buy', ''] };

  function renderAgent() {
    const card = $('agent-card');
    if (!goal.kit?.budget) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    const m = agent.mandateOf(goal);
    $('mandate-badge').innerHTML = `<span class="badge ${m.budgetLeft > 0 ? 'ok' : ''}">${money(m.budgetLeft)} left to spend</span>`;
    $('mandate').innerHTML = [
      ['Kit budget', money(m.budget)],
      ['Spent', money(m.spent)],
      ['Awaiting approval', money(m.pending)],
      ['Max per item', money(m.perItemMax)],
      ['Auto-buy up to', money(m.autoBuyLimit)],
    ]
      .map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`)
      .join('');
    const canRun = goal.status === 'active' && m.budgetLeft >= 1;
    $('agent-run').disabled = !canRun;
    $('agent-run').title = canRun ? '' : goal.status !== 'active' ? 'The agent can shop once the goal is funded.' : 'The kit budget is used up.';

    $('carts').innerHTML = [...m.carts]
      .reverse()
      .map((c) => {
        const [label, cls] = CART_STATUS[c.status] || [c.status, ''];
        return `
        <article class="cart ${c.status}">
          <header class="row">
            <strong style="flex:1">Cart ${esc(c.id)} · ${money(c.total)}</strong>
            <span class="hint">${c.requestedBy === 'student' ? `requested by ${esc(goal.studentName)}` : 'run by sponsor'} · ${fmtTime(c.createdAt)}</span>
            <span class="badge ${cls}">${esc(label)}</span>
          </header>
          ${c.request ? `<p class="hint" style="margin:6px 0 0">Request: “${esc(c.request)}”</p>` : ''}
          <ol class="trace">${c.trace.map((t) => `<li class="${esc(t.step)}"><span>${esc(t.step)}</span>${esc(t.text)}</li>`).join('')}</ol>
          ${c.items.length ? `<table class="cart-items"><tbody>${c.items.map((i) => `<tr><td>${i.qty}× <strong>${esc(i.title)}</strong><div class="hint">${esc(i.reason)}</div></td><td class="amount">${money(i.line)}</td></tr>`).join('')}</tbody></table>` : ''}
          ${c.status === 'awaiting_approval' && c.approvalReasons?.length ? `<p class="hint">${c.approvalReasons.map(esc).join(' ')}</p>` : ''}
          ${c.status === 'awaiting_approval' ? `<div class="row"><button class="btn money small" data-buy="${esc(c.id)}">Approve &amp; pay ${money(c.total)} with PayPal</button><button class="btn secondary small" data-decline="${esc(c.id)}">Decline</button></div>` : ''}
          ${c.payment ? `<p class="hint" style="margin:8px 0 0">Paid to ${esc(c.payment.merchant)} · <code class="mono">${esc(c.payment.batchId)}</code> · ${c.payment.simulated ? 'simulated payout' : 'PayPal Payouts API (Sandbox)'}</p>` : ''}
        </article>`;
      })
      .join('');
    $('carts').querySelectorAll('[data-buy]').forEach((btn) =>
      btn.addEventListener('click', () => act(btn, 'Paying with PayPal…', () => agent.approve(id, btn.dataset.buy), 'Study kit bought.')),
    );
    $('carts').querySelectorAll('[data-decline]').forEach((btn) =>
      btn.addEventListener('click', () => act(btn, 'Declining…', () => agent.decline(id, btn.dataset.decline), 'Cart declined.')),
    );
  }

  $('agent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await act(
      $('agent-run'),
      'Agent is shopping…',
      async () => {
        await agent.run(id, { request: $('agent-request').value, actor: 'sponsor' });
        $('agent-request').value = '';
      },
      'The agent finished. See its cart below.',
    );
  });

  /* ---------------- Money ledger (AG Grid) ---------------- */

  function ledgerRows() {
    return [
      ...goal.contributions.map((c) => ({ id: `c-${c.id}`, at: c.at, type: 'Sponsor payment', from: c.sponsorName, to: 'LearnBond (held)', amount: c.amount, ref: c.captureId, mode: c.sandbox ? 'PayPal Sandbox checkout' : 'Simulated' })),
      ...goal.milestones
        .filter((m) => m.payout)
        .map((m) => ({ id: `p-${m.id}`, at: m.payout.at, type: 'Payout to student', from: 'LearnBond (held)', to: goal.studentName, amount: -m.amount, ref: m.payout.batchId, mode: m.payout.simulated ? 'Simulated' : 'PayPal Payouts API', note: m.title })),
      ...(goal.kit?.carts || [])
        .filter((c) => c.payment)
        .map((c) => ({ id: `k-${c.id}`, at: c.payment.at, type: 'Agent purchase', from: 'LearnBond (held)', to: c.payment.merchant, amount: -c.total, ref: c.payment.batchId, mode: c.payment.simulated ? 'Simulated' : 'PayPal Payouts API', note: c.items.map((i) => `${i.qty}× ${i.sku}`).join(', ') })),
      ...goal.refunds.map((r, i) => ({ id: `r-${i}`, at: r.at, type: 'Refund', from: 'LearnBond (held)', to: r.to, amount: -r.amount, ref: r.refundId, mode: r.simulated === false ? 'PayPal Refunds API' : 'Simulated' })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }

  const TYPE_CLASS = { 'Sponsor payment': 'info', 'Payout to student': 'ok', 'Agent purchase': 'warn', Refund: '' };

  function renderLedger() {
    const rows = ledgerRows();
    const pinned = [{ id: 'held', type: 'Held now', amount: goal.available, note: `of ${money(goal.funded)} funded` }];
    if (!grids.available()) {
      $('ledger-grid').classList.add('hidden');
      document.querySelector('#contrib-card .grid-tools').classList.add('hidden');
      $('trail').innerHTML = rows.length
        ? rows.map((r) => `<p style="margin:0 0 8px"><span class="hint">${fmtTime(r.at)}</span> · <strong>${esc(r.type)}</strong> ${esc(r.from)} → ${esc(r.to)} · ${money(Math.abs(r.amount))} · <code class="mono">${esc(r.ref)}</code> <span class="badge ${r.mode === 'Simulated' ? 'warn' : 'ok'}">${esc(r.mode)}</span></p>`).join('')
        : '<p class="hint">No money has moved yet.</p>';
      return;
    }
    if (ledgerGrid) {
      ledgerGrid.setGridOption('rowData', rows);
      ledgerGrid.setGridOption('pinnedBottomRowData', pinned);
      return;
    }
    ledgerGrid = grids.create($('ledger-grid'), {
      rowData: rows,
      pinnedBottomRowData: pinned,
      domLayout: 'autoHeight',
      getRowId: (p) => p.data.id,
      tooltipShowDelay: 300,
      overlayNoRowsTemplate: '<span class="hint">No money has moved yet.</span>',
      columnDefs: [
        { field: 'at', headerName: 'Time', valueFormatter: grids.timeFmt, width: 165, sort: 'desc' },
        { field: 'type', headerName: 'Type', width: 170, cellRenderer: (p) => (p.value ? `<span class="badge ${TYPE_CLASS[p.value] ?? 'ok'}">${esc(p.value)}</span>` : '') },
        { field: 'from', headerName: 'From', width: 150 },
        { field: 'to', headerName: 'To', flex: 1, minWidth: 150 },
        {
          field: 'amount',
          headerName: 'Amount',
          width: 120,
          type: 'rightAligned',
          filter: 'agNumberColumnFilter',
          enableCellChangeFlash: true,
          valueFormatter: (p) => (p.value == null ? '' : `${p.value > 0 && !p.node.rowPinned ? '+' : ''}${money(p.value)}`),
          cellClassRules: { 'cell-money': (p) => p.value > 0, 'cell-out': (p) => p.value < 0 },
        },
        { field: 'mode', headerName: 'Rail', width: 190, cellRenderer: (p) => (p.value ? `<span class="badge ${p.value === 'Simulated' ? 'warn' : 'ok'}">${esc(p.value)}</span>` : '') },
        { field: 'ref', headerName: 'PayPal reference', width: 200, cellClass: 'mono' },
        { field: 'note', headerName: 'Note', flex: 1, minWidth: 160, tooltipField: 'note' },
      ],
    });
    grids.toolbar(ledgerGrid, { search: $('ledger-search'), exportBtn: $('ledger-export'), fileName: `learnbond-ledger-${id}.csv` });
  }

  /* ---------------- Guardrails & audit ---------------- */

  function renderGuardrails() {
    const g = goal.guardrails;
    $('guardrails').innerHTML = `
      <ul style="margin:0;padding-left:20px">
        <li>The Examiner must be at least <strong>${Math.round(g.minConfidence * 100)}%</strong> confident, and quote the student word for word. Quotes are checked against the real transcript.</li>
        <li>Payouts above <strong>${money(g.autoApproveLimit)}</strong> wait for sponsor approval.</li>
        <li>At most <strong>${money(g.dailyCap)}</strong> is released in any 24 hours without approval.</li>
        <li>At most <strong>${g.maxAttemptsPerDay}</strong> exam attempts per milestone per day.</li>
        <li>Pasted or unusually fast answers send the payout to sponsor review.</li>
        <li>After <strong>${esc(goal.deadline)}</strong>, any unearned money is refunded automatically.</li>
      </ul>`;
  }

  const actorClass = (actor) => (actor.startsWith('agent') ? 'info' : actor.startsWith('guardrails') ? 'warn' : actor.startsWith('paypal') ? 'bad' : '');

  function renderAudit() {
    $('chain').innerHTML = goal.chain.valid
      ? `<span class="badge ok">✓ Hash chain intact (${goal.chain.length} entries)</span>`
      : `<span class="badge bad">✗ Chain broken at entry ${goal.chain.brokenAt}</span>`;

    if (grids.available()) {
      $('audit-table').classList.add('hidden');
      const rows = goal.audit.map((e) => ({ seq: e.seq, ts: e.ts, actor: e.actor, action: e.action.replaceAll('_', ' '), details: summarize(e.data), hash: e.hash, prevHash: e.prevHash }));
      if (auditGrid) return auditGrid.setGridOption('rowData', rows);
      auditGrid = grids.create($('audit-grid'), {
        rowData: rows,
        getRowId: (p) => String(p.data.seq),
        tooltipShowDelay: 300,
        columnDefs: [
          { field: 'seq', headerName: '#', width: 80, sort: 'desc', filter: 'agNumberColumnFilter' },
          { field: 'ts', headerName: 'Time', valueFormatter: grids.timeFmt, width: 165 },
          { field: 'actor', headerName: 'Actor', width: 200, floatingFilter: true, cellRenderer: (p) => `<span class="badge ${actorClass(p.value)}">${esc(p.value)}</span>` },
          { field: 'action', headerName: 'Action', width: 180, floatingFilter: true, cellClass: 'strong' },
          { field: 'details', headerName: 'Details', flex: 1, minWidth: 280, tooltipField: 'details' },
          { field: 'hash', headerName: 'SHA-256', width: 150, cellClass: 'mono', valueFormatter: (p) => `${p.value.slice(0, 12)}…`, tooltipValueGetter: (p) => `hash ${p.data.hash} · prev ${p.data.prevHash}` },
        ],
      });
      grids.toolbar(auditGrid, { search: $('audit-search'), exportBtn: $('audit-export'), fileName: `learnbond-audit-${id}.csv` });
      return;
    }

    $('audit-grid').classList.add('hidden');
    $('audit-search').closest('.grid-tools').classList.add('hidden');
    $('audit').innerHTML = goal.audit
      .map(
        (e) => `
        <tr>
          <td>${e.seq}</td>
          <td style="white-space:nowrap">${fmtTime(e.ts)}</td>
          <td><span class="badge ${actorClass(e.actor)}">${esc(e.actor)}</span></td>
          <td><strong>${esc(e.action.replaceAll('_', ' '))}</strong></td>
          <td class="detail">${esc(summarize(e.data))}</td>
          <td><code class="mono" title="${esc(e.hash)}">${esc(e.hash.slice(0, 10))}…</code></td>
        </tr>`,
      )
      .join('');
  }

  function summarize(data) {
    return Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' · ')
      .slice(0, 400);
  }

  $('close-btn').addEventListener('click', async () => {
    if (!confirm(`Refund ${money(goal.available)} of unearned or unspent funds to the sponsors${goal.status === 'completed' ? '' : ' and close this goal'}?`)) return;
    await act($('close-btn'), 'Refunding…', () => goals.closeAndRefund(id, `sponsor:${goal.sponsorName}`, 'Closed by sponsor'), 'Goal closed. Unearned funds refunded.');
  });

  load();
  onExternalChange(load);
  setInterval(load, 5000);
})();
