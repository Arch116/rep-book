// Planning: weekly schedule ("Up next") and the lighter-week (deload) reminder.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// The routine after the one you did last, in the order of your Routines list.
function rotationNext() {
  const routines = Store.routines;
  if (!routines.length) return null;
  const last = [...Store.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const i = last ? routines.findIndex(r => r.id === last.routineId) : -1;
  return routines[(i + 1) % routines.length];
}

// What to do next: from your weekly schedule if you've set one, otherwise
// the next routine in rotation. Returns { routine, label }.
function upNext() {
  const routines = Store.routines;
  if (!routines.length) return null;
  const sched = Store.settings.schedule || {};
  const planned = Object.values(sched).some(id => routines.some(r => r.id === id));
  if (!planned) return { routine: rotationNext(), label: 'Up next' };

  const now = new Date();
  const doneToday = Store.sessions.filter(s => sameDay(s.startedAt, now));
  const todays = routines.find(r => r.id === sched[now.getDay()]);
  for (let i = 0; i < 7; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    const r = routines.find(x => x.id === sched[day.getDay()]);
    if (!r) continue;
    if (i === 0 && doneToday.some(s => s.routineId === r.id)) continue;
    if (i === 0) return { routine: r, label: 'Today' };
    const when = i === 1 ? 'tomorrow' : DAY_NAMES[day.getDay()];
    const today = todays && doneToday.some(s => s.routineId === todays.id) ? 'Done for today' : 'Rest day';
    return { routine: r, label: `${today} · next up ${when}` };
  }
  return { routine: rotationNext(), label: 'Up next' };
}

/* ---------- Lighter week (deload) ---------- */

const WEEK = 7 * 864e5;
const weekStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x.getTime(); };

function inDeloadWeek() {
  const started = Store.settings.deloadStartedAt;
  return !!started && Date.now() - new Date(started) < WEEK;
}

// How many different weeks you've trained since your last lighter week.
function trainingWeeksSinceDeload() {
  const since = Store.settings.deloadStartedAt;
  const weeks = new Set(Store.sessions
    .filter(s => !since || new Date(s.startedAt) - new Date(since) >= WEEK)
    .map(s => weekStart(s.startedAt)));
  return weeks.size;
}

function deloadDue() {
  const st = Store.settings;
  if (!st.deloadEvery || inDeloadWeek()) return false;
  if (st.deloadSnoozedUntil && Date.now() < new Date(st.deloadSnoozedUntil)) return false;
  return trainingWeeksSinceDeload() >= st.deloadEvery;
}

// Home card: a reminder, or the lighter week in progress.
function deloadCardHTML() {
  const st = Store.settings;
  if (inDeloadWeek()) {
    const ends = new Date(new Date(st.deloadStartedAt).getTime() + WEEK);
    return `
      <div class="card deload-card">
        <div class="stat-label">Lighter week</div>
        <div class="muted">Working sets start at ${st.deloadPercent}% of your usual weight until ${ends.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}.</div>
        <button class="link-btn" data-plan-action="end-deload">End lighter week early</button>
      </div>`;
  }
  if (!deloadDue()) return '';
  const n = trainingWeeksSinceDeload();
  return `
    <div class="card deload-card">
      <div class="stat-label">Time for a lighter week?</div>
      <div class="muted">You've trained ${n} weeks since your last break. A week at about ${st.deloadPercent}% weight helps you recover and keep getting stronger.</div>
      <div class="deload-actions">
        <button class="btn" data-plan-action="start-deload">Start this week</button>
        <button class="btn secondary" data-plan-action="snooze-deload">Not now</button>
      </div>
    </div>`;
}

viewEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-plan-action]');
  if (!btn) return;
  const a = btn.dataset.planAction;
  if (a === 'start-deload') Store.setSetting('deloadStartedAt', new Date().toISOString());
  else if (a === 'snooze-deload') Store.setSetting('deloadSnoozedUntil', new Date(Date.now() + WEEK).toISOString());
  else if (a === 'end-deload') {
    if (!confirm('End the lighter week now? Weights go back to normal from your next workout.')) return;
    // Keep the date it started (so the weeks count from it), just end it now.
    Store.setSetting('deloadStartedAt', new Date(Date.now() - WEEK).toISOString());
  }
  route({ keepScroll: true });
});
