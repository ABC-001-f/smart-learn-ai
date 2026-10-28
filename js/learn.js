(() => {
  'use strict';
  const { money, esc, param, renderModes, statusBadge, toast, withLoading } = LB.common;
  const goals = LB.goals;
  const { onExternalChange } = LB.store;

  const id = param('id');
  const $ = (sel) => document.getElementById(sel);

  let goal = null;
  let selectedId = null;
  const chats = {}; // milestoneId -> [{ role, content }]
  let exam = null; // { sessionId, asked, max }
  let signals = null;
  let tutorBusy = false;

  renderModes($('modes'));

  async function load() {
    await goals.sweepDeadlines();
    goal = goals.mustGoal(id);
    const current = goal.milestones.find((m) => m.status === 'active');
    if (!selectedId || !goal.milestones.some((m) => m.id === selectedId)) {
      selectedId = (current || goal.milestones.find((m) => m.status !== 'paid') || goal.milestones[0]).id;
    }
    render();
  }

  const selected = () => goal.milestones.find((m) => m.id === selectedId);

  function render() {
    $('loading').classList.add('hidden');
    $('app').classList.remove('hidden');
    document.title = `${goal.studentName}'s study room · LearnBond`;
    $('sponsor-line').textContent = `${goal.sponsorName} is sponsoring you, ${goal.studentName}`;
    $('title').textContent = goal.title;
    $('earned').textContent = `Earned ${money(goal.released)} of ${money(goal.budget)}`;
    $('goal-status').innerHTML = statusBadge(goal.status);

    const notActive = $('not-active');
    if (goal.status === 'awaiting_funds') {
      notActive.innerHTML = `<strong>Waiting for your sponsor to fund this goal.</strong> <span class="hint">You can start studying once ${money(goal.budget)} is held for you.</span>`;
    } else if (goal.status === 'closed') {
      notActive.innerHTML = `<strong>This goal is closed.</strong> <span class="hint">${esc(goal.closedReason || '')}</span>`;
    } else if (goal.status === 'completed') {
      notActive.innerHTML = `<strong>🎉 You completed every milestone and earned ${money(goal.released)}.</strong>`;
    }
    notActive.classList.toggle('hidden', goal.status === 'active');

    $('ms-nav').innerHTML = goal.milestones
      .map(
        (m, i) => `
        <button data-id="${m.id}" class="${m.id === selectedId ? 'selected' : ''}" ${m.status === 'locked' ? 'disabled' : ''}>
          <span class="t">${i + 1}. ${esc(m.title)}</span>
          <span class="s"><span>${money(m.amount)}</span>${statusBadge(m.status)}</span>
        </button>`,
      )
      .join('');
    $('ms-nav').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        if (exam) return toast('Finish the exam first.');
        selectedId = b.dataset.id;
        render();
      }),
    );

    const m = selected();
    const canStudy = goal.status === 'active' && m.status === 'active';
    $('tutor-title').textContent = `Tutor: ${m.title}`;
    $('tutor-objectives').textContent = `You'll need to show you can: ${m.objectives.join(' · ')}`;
    $('tutor-form').querySelectorAll('textarea, button').forEach((el) => (el.disabled = !canStudy));
    $('ready-btn').disabled = !canStudy;
    $('tutor-card').classList.toggle('hidden', Boolean(exam));
    renderTutorChat();
    renderKit();
  }

  /* ---------------- Study Kit Agent (student request) ---------------- */

  function renderKit() {
    const kit = goal.kit;
    $('kit-card').classList.toggle('hidden', !kit?.budget || goal.status !== 'active');
    if (!kit?.budget) return;
    const last = kit.carts.filter((c) => c.requestedBy === 'student').at(-1);
    if (!last) return;
    const items = last.items.map((i) => esc(i.title)).join(', ');
    $('kit-result').innerHTML =
      last.status === 'bought'
        ? `✅ Bought for you: ${items} (${money(last.total)}).`
        : last.status === 'awaiting_approval'
          ? `⏳ The agent picked ${items} (${money(last.total)}). Waiting for ${esc(goal.sponsorName)} to approve.`
          : last.status === 'declined'
            ? 'Your sponsor declined the last cart.'
            : `The agent found nothing worth buying: ${esc(last.rationale)}`;
  }

  $('kit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await withLoading($('kit-btn'), 'Agent is shopping…', () => LB.agent.run(id, { request: $('kit-request').value, actor: 'student' }));
      $('kit-request').value = '';
      goal = goals.mustGoal(id);
      renderKit();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ---------------- Tutor ---------------- */

  function bubble(role, text) {
    const who = { user: 'You', tutor: 'Tutor', examiner: 'Examiner' }[role];
    return `<div class="msg ${role}"><span class="who">${who}</span>${esc(text)}</div>`;
  }

  function renderTutorChat() {
    const m = selected();
    const history = chats[m.id] || [];
    const el = $('tutor-chat');
    const intro =
      m.status === 'paid'
        ? `You already mastered this milestone and earned ${money(m.amount)}. 🎉`
        : m.status === 'awaiting_approval'
          ? 'The Examiner verified your mastery! Your sponsor is reviewing the release.'
          : `Hi ${goal.studentName}! Let's work on "${m.title}". Ask me anything, or say "teach me from the start".`;
    el.innerHTML = bubble('tutor', intro) + history.map((h) => bubble(h.role === 'user' ? 'user' : 'tutor', h.content)).join('');
    el.scrollTop = el.scrollHeight;
  }

  $('tutor-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('tutor-input');
    const text = input.value.trim();
    if (!text || tutorBusy) return;
    const m = selected();
    const history = (chats[m.id] ||= []);
    history.push({ role: 'user', content: text });
    input.value = '';
    renderTutorChat();
    $('tutor-chat').insertAdjacentHTML('beforeend', '<div class="msg tutor thinking"><span class="who">Tutor</span>Thinking</div>');
    $('tutor-chat').scrollTop = $('tutor-chat').scrollHeight;
    tutorBusy = true;
    try {
      const sendBtn = $('tutor-form').querySelector('button[type="submit"]');
      const reply = await withLoading(sendBtn, 'Sending…', () => goals.tutorReply(id, m.id, history));
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      history.pop();
      input.value = text;
      toast(err.message, true);
    } finally {
      tutorBusy = false;
    }
    renderTutorChat();
  });

  $('tutor-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('tutor-form').requestSubmit();
    }
  });

  /* ---------------- Exam ---------------- */

  $('ready-btn').addEventListener('click', async () => {
    const m = selected();
    try {
      const res = await withLoading($('ready-btn'), 'Tutor is briefing the Examiner…', () => goals.startExam(id, m.id, chats[m.id] || []));
      exam = { sessionId: res.sessionId, asked: res.asked, max: res.max };
      $('tutor-card').classList.add('hidden');
      $('exam-card').classList.remove('hidden');
      $('verdict').innerHTML = '';
      $('answer-form').classList.remove('hidden');
      $('claim').innerHTML = `
        <h3>Tutor's readiness claim</h3>
        <p style="margin:0">${esc(res.readiness.claim)}</p>
        ${res.readiness.suspected_gaps.length ? `<p class="hint" style="margin:6px 0 0">Suspected gaps the Examiner will probe:</p><ul>${res.readiness.suspected_gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}`;
      $('exam-chat').innerHTML = (res.remark ? bubble('examiner', res.remark) : '') + bubble('examiner', res.question);
      updateProgress();
      resetSignals();
      $('answer').focus();
    } catch (err) {
      toast(err.message, true);
    }
  });

  function updateProgress() {
    $('exam-progress').textContent = `Question ${exam.asked} of up to ${exam.max}`;
  }

  // Integrity signals: the Examiner sees these as hints for follow-up questions, never as automatic failure.
  function resetSignals() {
    signals = { startedAt: null, pastedChars: 0, voice: false };
    renderSignals();
  }

  function renderSignals() {
    const parts = [];
    if (signals.pastedChars > 20) parts.push(`<span class="flag">Pasted text detected (${signals.pastedChars} chars). The Examiner will see this.</span>`);
    if (signals.voice) parts.push('🎙 Spoken answer');
    $('signals').innerHTML = parts.join(' · ');
  }

  $('answer').addEventListener('keydown', () => {
    signals.startedAt ??= Date.now();
  });
  $('answer').addEventListener('paste', (e) => {
    signals.startedAt ??= Date.now();
    signals.pastedChars += (e.clipboardData?.getData('text') || '').length;
    renderSignals();
  });

  $('answer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const answer = $('answer').value.trim();
    if (!answer || !exam) return;
    stopListening();
    const typingSeconds = signals.startedAt ? (Date.now() - signals.startedAt) / 1000 : 0;
    $('exam-chat').insertAdjacentHTML('beforeend', bubble('user', answer));
    $('exam-chat').insertAdjacentHTML('beforeend', '<div class="msg examiner thinking" id="typing"><span class="who">Examiner</span>Weighing your answer</div>');
    scrollExam();
    try {
      const res = await withLoading($('answer-btn'), 'Examiner is weighing it…', () =>
        goals.answerExam(exam.sessionId, answer, { pastedChars: signals.pastedChars, voice: signals.voice, typingSeconds }),
      );
      $('typing')?.remove();
      $('answer').value = '';
      resetSignals();
      if (!res.done) {
        exam.asked = res.asked;
        updateProgress();
        $('exam-chat').insertAdjacentHTML('beforeend', (res.remark ? bubble('examiner', res.remark) : '') + bubble('examiner', res.question));
        scrollExam();
        $('answer').focus();
      } else {
        showVerdict(res);
      }
    } catch (err) {
      $('typing')?.remove();
      $('exam-chat').lastElementChild?.remove();
      toast(err.message, true);
    }
  });

  const scrollExam = () => ($('exam-chat').scrollTop = $('exam-chat').scrollHeight);

  function showVerdict({ verdict, release }) {
    $('answer-form').classList.add('hidden');
    const m = selected();
    let moneyLine = '';
    if (release?.payout) {
      moneyLine = `<div class="payout-pop">+${money(m.amount)}</div><p>Released to your PayPal (${esc(goal.studentEmail)}) · payout <code class="mono">${esc(release.payout.batchId)}</code> <span class="badge warn">simulated payout</span></p>`;
    } else if (release) {
      moneyLine = `<p><strong>${money(m.amount)} is waiting for ${esc(goal.sponsorName)}'s approval.</strong></p><ul>${release.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
    }

    $('verdict').innerHTML = `
      <div class="verdict ${verdict.passed ? 'pass' : 'fail'}">
        <h2>${verdict.passed ? '✅ Mastery verified' : '⏳ Not yet'}</h2>
        <p>${esc(verdict.remark)}</p>
        <p class="hint">${esc(verdict.summary)}</p>
        <p class="confidence">Examiner confidence <span class="bar"><span style="width:${Math.round(verdict.confidence * 100)}%"></span></span> <strong>${Math.round(verdict.confidence * 100)}%</strong></p>
        ${verdict.evidence.length ? `<p class="hint" style="margin-top:8px">Evidence quoted from your answers:</p>${verdict.evidence.map((q) => `<div class="receipt"><div class="quote">“${esc(q)}”</div></div>`).join('')}` : ''}
        ${verdict.overrides.length ? `<p style="margin-top:8px"><strong>Guardrails overrode the AI:</strong></p><ul>${verdict.overrides.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
        ${verdict.concerns.length ? `<p class="hint">Notes: ${verdict.concerns.map(esc).join(' · ')}</p>` : ''}
        ${moneyLine}
        <div class="row" style="margin-top:12px"><button class="btn" id="back-btn">${verdict.passed ? 'Continue' : 'Back to the Tutor'}</button></div>
      </div>`;
    $('back-btn').addEventListener('click', async () => {
      exam = null;
      $('exam-card').classList.add('hidden');
      selectedId = null;
      await load();
    });
  }

  /* ---------------- Voice answers (Web Speech API) ---------------- */

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;

  if (!Recognition) {
    $('mic-btn').classList.add('hidden');
  } else {
    $('mic-btn').addEventListener('click', () => (recognizer ? stopListening() : startListening()));
  }

  function startListening() {
    recognizer = new Recognition();
    recognizer.lang = 'en-NG';
    recognizer.continuous = true;
    recognizer.interimResults = false;
    const base = $('answer').value;
    let spoken = '';
    recognizer.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) spoken += `${e.results[i][0].transcript.trim()} `;
      }
      $('answer').value = `${base}${base && !base.endsWith(' ') ? ' ' : ''}${spoken}`.trimStart();
      signals.voice = true;
      signals.startedAt ??= Date.now();
      renderSignals();
    };
    recognizer.onerror = (e) => {
      toast(`Microphone: ${e.error}`, true);
      stopListening();
    };
    recognizer.onend = () => stopListening();
    recognizer.start();
    $('mic-btn').classList.add('listening');
    $('mic-btn').textContent = '■ Stop';
  }

  function stopListening() {
    if (!recognizer) return;
    const r = recognizer;
    recognizer = null;
    r.onend = null;
    r.stop();
    $('mic-btn').classList.remove('listening');
    $('mic-btn').textContent = '🎙 Speak answer';
  }

  /* ---------------- Boot ---------------- */

  const refresh = () => {
    if (!exam && !tutorBusy) load().catch(() => {});
  };
  load().catch((err) => {
    $('loading').classList.remove('loading');
    $('loading').textContent = err.message;
  });
  onExternalChange(refresh);
  setInterval(refresh, 6000);
})();
