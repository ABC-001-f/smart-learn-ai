(() => {
  'use strict';
  const { money, esc, renderModes, statusBadge, toast, withLoading } = LB.common;
  const goals = LB.goals;

  const form = document.getElementById('goal-form');
  const planEl = document.getElementById('plan');
  const planBtn = document.getElementById('plan-btn');
  let plan = null;

  renderModes(document.getElementById('modes'));

  const inDays = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  form.deadline.value = inDays(21);
  form.deadline.min = inDays(1);

  document.getElementById('fill-example').addEventListener('click', () => {
    form.goalTitle.value = 'Pass WAEC Maths: quadratic equations';
    form.details.value = 'Solve quadratics by factoring, completing the square and the quadratic formula. Understand what the discriminant says about the roots, and solve word problems.';
    form.level.value = 'secondary school';
    form.studentName.value = 'Chidi';
    form.studentEmail.value ||= 'chidi-student@personal.example.com';
    form.sponsorName.value = 'Aunty Ngozi';
    form.budget.value = 60;
    form.count.value = 3;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      plan = await withLoading(planBtn, 'AI is designing milestones…', () =>
        goals.planMilestones({
          title: form.goalTitle.value,
          details: form.details.value,
          level: form.level.value,
          budget: Number(form.budget.value),
          count: Number(form.count.value),
        }),
      );
      planBtn.textContent = 'Redesign milestones with AI';
      renderPlan();
      planEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(err.message, true);
    }
  });

  function renderPlan() {
    planEl.classList.remove('hidden');
    planEl.innerHTML = `
      <h2>Milestone plan</h2>
      <p class="hint">${esc(plan.rationale)}</p>
      <div>
        ${plan.milestones
          .map(
            (m, i) => `
          <div class="plan-item">
            <label>Milestone ${i + 1}<input data-i="${i}" data-k="title" value="${esc(m.title)}" maxlength="120"></label>
            <label>Amount (USD)<input data-i="${i}" data-k="amount" type="number" min="1" step="0.01" value="${m.amount}"></label>
            <ul>${m.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
          </div>`,
          )
          .join('')}
      </div>
      <div class="row" style="margin-top:16px">
        <strong>To fund: <span id="plan-total">${totalLabel()}</span></strong>
        <span class="spacer"></span>
        <button class="btn money" id="create-btn">Create goal &amp; go to funding</button>
      </div>`;

    planEl.querySelectorAll('input[data-i]').forEach((input) =>
      input.addEventListener('input', () => {
        const m = plan.milestones[Number(input.dataset.i)];
        m[input.dataset.k] = input.dataset.k === 'amount' ? Number(input.value) : input.value;
        document.getElementById('plan-total').textContent = totalLabel();
      }),
    );
    document.getElementById('create-btn').addEventListener('click', createGoal);
  }

  const total = () => plan.milestones.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const kitBudget = () => Math.max(0, Number(form.kitBudget.value) || 0);
  const totalLabel = () =>
    kitBudget() ? `${money(total())} rewards + ${money(kitBudget())} study kit = ${money(total() + kitBudget())}` : money(total());
  form.kitBudget.addEventListener('input', () => {
    const el = document.getElementById('plan-total');
    if (el) el.textContent = totalLabel();
  });

  async function createGoal(e) {
    const btn = e.currentTarget;
    if (!form.reportValidity()) return;
    try {
      const goal = await withLoading(btn, 'Creating goal…', () =>
        goals.createGoal({
          title: form.goalTitle.value,
          details: form.details.value,
          studentName: form.studentName.value,
          studentEmail: form.studentEmail.value,
          sponsorName: form.sponsorName.value,
          deadline: form.deadline.value,
          milestones: plan.milestones,
          guardrails: {
            minConfidence: Number(form.minConfidence.value),
            autoApproveLimit: Number(form.autoApproveLimit.value),
            dailyCap: Number(form.dailyCap.value),
          },
          kit: {
            budget: kitBudget(),
            perItemMax: Number(form.kitPerItemMax.value),
            autoBuyLimit: Number(form.kitAutoBuyLimit.value),
          },
        }),
      );
      location.href = `goal.html?id=${encodeURIComponent(goal.id)}`;
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------------- Portfolio (AG Grid) ---------------- */

  const grids = LB.grids;
  let portfolio = null;

  const STATUS_LABEL = { awaiting_funds: 'Awaiting funds', active: 'Active', completed: 'Completed', closed: 'Closed' };

  function portfolioRows(list) {
    return list.map((g) => ({
      id: g.id,
      title: g.title,
      student: g.studentName,
      sponsor: g.sponsorName,
      status: g.status,
      budget: g.budget,
      funded: g.funded,
      released: g.released,
      kitSpent: g.kit?.spent || 0,
      refunded: g.refunded,
      held: LB.guardrails.available(g),
      progress: g.milestones.length ? g.milestones.filter((m) => m.status === 'paid').length / g.milestones.length : 0,
      milestones: `${g.milestones.filter((m) => m.status === 'paid').length}/${g.milestones.length}`,
      deadline: g.deadline,
    }));
  }

  function totalsRow(rows) {
    const sum = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
    return [{ id: '__total', title: `Portfolio total · ${rows.length} goal${rows.length === 1 ? '' : 's'}`, budget: sum('budget'), funded: sum('funded'), released: sum('released'), kitSpent: sum('kitSpent'), refunded: sum('refunded'), held: sum('held') }];
  }

  function renderPortfolio(list) {
    const host = document.getElementById('portfolio-grid');
    if (!grids.available() || !list.length) {
      host.classList.add('hidden');
      return false;
    }
    host.classList.remove('hidden');
    const rows = portfolioRows(list);
    if (portfolio) {
      portfolio.setGridOption('rowData', rows);
      portfolio.setGridOption('pinnedBottomRowData', totalsRow(rows));
      return true;
    }
    const moneyCol = (field, headerName, extra = {}) => ({ field, headerName, valueFormatter: grids.moneyFmt, type: 'rightAligned', filter: 'agNumberColumnFilter', width: 120, enableCellChangeFlash: true, ...extra });
    portfolio = grids.create(host, {
      rowData: rows,
      pinnedBottomRowData: totalsRow(rows),
      domLayout: 'autoHeight',
      getRowId: (p) => p.data.id,
      rowClass: 'clickable',
      onRowClicked: (e) => !e.node.rowPinned && (location.href = `goal.html?id=${encodeURIComponent(e.data.id)}`),
      columnDefs: [
        { field: 'title', headerName: 'Goal', flex: 2, minWidth: 220, pinned: 'left', cellRenderer: (p) => (p.node.rowPinned ? `<strong>${esc(p.value)}</strong>` : `<a href="goal.html?id=${encodeURIComponent(p.data.id)}">${esc(p.value)}</a>`) },
        { field: 'student', headerName: 'Student', width: 120 },
        { field: 'status', headerName: 'Status', width: 160, cellRenderer: (p) => (p.value ? statusBadge(p.value) : ''), filterValueGetter: (p) => STATUS_LABEL[p.data.status] || p.data.status },
        { field: 'progress', headerName: 'Milestones', width: 150, filter: false, cellRenderer: (p) => (p.node.rowPinned ? '' : `<span class="cell-progress"><span class="bar"><span class="released" style="width:${Math.round(p.value * 100)}%"></span></span>${esc(p.data.milestones)}</span>`) },
        moneyCol('budget', 'Budget'),
        moneyCol('funded', 'Funded'),
        moneyCol('released', 'Earned', { cellClass: 'cell-money' }),
        moneyCol('kitSpent', 'Agent spent'),
        moneyCol('held', 'Held now'),
        moneyCol('refunded', 'Refunded'),
        { field: 'deadline', headerName: 'Deadline', width: 120 },
      ],
    });
    grids.toolbar(portfolio, { search: document.getElementById('portfolio-search'), exportBtn: document.getElementById('portfolio-export'), fileName: 'learnbond-portfolio.csv' });
    return true;
  }

  async function renderGoals() {
    await goals.sweepDeadlines();
    const list = goals.listGoals();
    const usedGrid = renderPortfolio(list);
    document.querySelector('.grid-tools').classList.toggle('hidden', !usedGrid);
    document.getElementById('goal-list').classList.toggle('hidden', usedGrid);
    if (usedGrid) return;
    document.getElementById('goal-list').innerHTML = list.length
      ? list
          .map(
            (g) => `
        <a class="card goal-card" href="goal.html?id=${encodeURIComponent(g.id)}">
          <div class="row"><strong style="flex:1">${esc(g.title)}</strong>${statusBadge(g.status)}</div>
          <p class="hint" style="margin:6px 0">${esc(g.sponsorName)} → ${esc(g.studentName)}</p>
          <div class="row hint"><span>Funded ${money(g.funded)} / ${money(g.budget)}</span><span class="spacer"></span><span>Released ${money(g.released)}</span></div>
        </a>`,
          )
          .join('')
      : '<div class="empty">No goals yet. Create the first one above.</div>';
  }

  renderGoals().catch((err) => toast(err.message, true));
  LB.store.onExternalChange(() => renderGoals().catch(() => {}));
})();
