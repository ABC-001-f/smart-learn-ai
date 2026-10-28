// Browser storage for goals, exam sessions and the audit log.
// Every read goes to localStorage fresh, so the sponsor and student tabs stay in sync.
LB.store = (() => {
  'use strict';
  const KEY = 'learnbond:db:v1';
  const empty = () => ({ goals: {}, sessions: {}, audit: [] });

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || empty();
    } catch {
      return empty();
    }
  }

  function write(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save to localStorage:', err);
    }
  }

  const getGoal = (id) => read().goals[id];
  const allGoals = () => Object.values(read().goals).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function putGoal(goal) {
    const state = read();
    state.goals[goal.id] = goal;
    write(state);
  }

  const getSession = (id) => read().sessions[id];
  const sessionsFor = (goalId) => Object.values(read().sessions).filter((s) => s.goalId === goalId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  function putSession(session) {
    const state = read();
    state.sessions[session.id] = session;
    write(state);
  }

  const auditLog = () => read().audit;

  function appendAudit(entry) {
    const state = read();
    state.audit.push(entry);
    write(state);
  }

  function resetAll() {
    write(empty());
  }

  // Fires when another tab changes the data (e.g. the student passes an exam while the sponsor watches).
  function onExternalChange(callback) {
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) callback();
    });
  }

  return { getGoal, allGoals, putGoal, getSession, sessionsFor, putSession, auditLog, appendAudit, resetAll, onExternalChange };
})();
