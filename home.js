// Home screen (#/home): what's next, how this week is going, and recent bests.

// The routine after the one you did last, in the order of your Routines list.
function nextRoutine() {
  const routines = Store.routines;
  if (!routines.length) return null;
  const last = [...Store.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const i = last ? routines.findIndex(r => r.id === last.routineId) : -1;
  return routines[(i + 1) % routines.length];
}

function startOfWeek() { // Sunday, 12:00 am
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function daysAgoText(iso) {
  const start = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((start(new Date()) - start(new Date(iso))) / 864e5);
  return days === 0 ? 'Today' : `${days}d ago`;
}

// "3 of 4" toward your weekly goal (or just "3" with no goal).
function workoutsTile(count) {
  const goal = Store.settings.weeklyGoal;
  if (!goal) return `<div class="stat-value">${count}</div><div class="muted small">since Sunday</div>`;
  const pct = Math.min(100, Math.round((count / goal) * 100));
  return `
    <div class="stat-value">${count} <span class="muted small">of ${goal}</span></div>
    <div class="goal-bar" role="img" aria-label="${count} of ${goal} workouts this week"><i style="width:${pct}%"></i></div>
    <div class="muted small">${count >= goal ? 'Goal met' : `${goal - count} to go`}</div>`;
}

// Exercises with a new personal best in the last 30 days, newest first.
function recentBests(limit = 3) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const found = [];
  for (const h of exerciseHistories()) {
    let best = null, latestNew = null;
    for (const p of h.points) {
      if (best && pointScore(h, p) > pointScore(h, best) && p.date >= since) latestNew = p;
      if (!best || pointScore(h, p) > pointScore(h, best)) best = p;
    }
    if (latestNew) found.push({ h, p: latestNew });
  }
  return found.sort((a, b) => b.p.date.localeCompare(a.p.date)).slice(0, limit);
}

function renderHome() {
  const routines = Store.routines;
  const sessions = Store.sessions;

  if (!routines.length && !sessions.length) {
    viewEl.innerHTML = `
      <div class="empty">
        <p>Welcome to Rep Book.<br>Start by creating a routine like Push, Pull, Deadlift or Squat.</p>
        <a class="btn" href="#/routines/new">New routine</a>
      </div>`;
    return;
  }

  // 1. Workout in progress, or what's up next
  let hero;
  const a = Store.active;
  if (a) {
    const mins = Math.floor((Date.now() - new Date(a.startedAt)) / 60000);
    const sets = a.exercises.flatMap(ex => ex.sets);
    hero = `
      <a class="card home-hero" href="#/workout">
        <div class="stat-label">Workout in progress</div>
        <div class="home-hero-name">${esc(a.routineName)}</div>
        <div class="muted">${mins} min · ${sets.filter(s => s.done).length} of ${sets.length} sets done</div>
        <span class="btn block">Resume workout</span>
      </a>`;
  } else {
    const next = nextRoutine();
    hero = next ? `
      <div class="card home-hero">
        <div class="stat-label">Up next</div>
        <div class="home-hero-name">${esc(next.name)}</div>
        <div class="muted">${routineSummary(next)}</div>
        <button class="btn block" data-w-action="start" data-id="${next.id}">Start ${esc(next.name)}</button>
        ${routines.length > 1 ? '<a class="link-btn home-other" href="#/workout">Pick a different routine</a>' : ''}
      </div>` : '';
  }

  // 2. This week
  const weekStart = startOfWeek().toISOString();
  const week = sessions.filter(s => s.startedAt >= weekStart);
  const lbs = week.reduce((sum, s) => sum + volume(s), 0);
  const last = [...sessions].sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0];
  const weekTiles = `
    <h2 class="section-label">This week</h2>
    <div class="stats">
      <div class="stat"><div class="stat-label">Workouts</div>${workoutsTile(week.length)}</div>
      <div class="stat"><div class="stat-label">Lifted</div><div class="stat-value">${lbs ? lbs.toLocaleString() : '0'}</div><div class="muted small">lbs</div></div>
      <div class="stat"><div class="stat-label">Last workout</div><div class="stat-value">${last ? daysAgoText(last.startedAt) : '–'}</div><div class="muted small">${last ? esc(last.routineName) : 'none yet'}</div></div>
    </div>`;

  // 3. Recent personal bests
  const bests = recentBests();
  const bestList = bests.length ? `
    <h2 class="section-label">New personal bests</h2>
    ${bests.map(({ h, p }) => `
      <a class="card routine-card" href="#/history/progress/${encodeURIComponent(h.key)}">
        <div>
          <div class="routine-name">${esc(h.name)}</div>
          <div class="muted small">${shortDate(p.date)}</div>
        </div>
        <span class="home-best">${pointText(h, p)}</span>
        <span class="chevron" aria-hidden="true">›</span>
      </a>`).join('')}` : '';

  // 4. Last workout
  const lastCard = last ? `
    <h2 class="section-label">Last workout</h2>
    <a class="card routine-card" href="#/history/${last.id}">
      <div>
        <div class="routine-name">${esc(last.routineName)}</div>
        <div class="muted small">${longDate(last.startedAt)}${durationText(last) ? ` · ${durationText(last)}` : ''}</div>
        <div class="muted small">${last.exercises.map(ex => `${esc(ex.name)} ${fmtSet(ex.type, bestSet(ex))}`).join(' · ')}</div>
      </div>
      <span class="chevron" aria-hidden="true">›</span>
    </a>` : '';

  // 5. Body weight
  const bw = Store.bodyweights.at(-1);
  const bwCard = `
    <h2 class="section-label">Body weight</h2>
    <div class="card routine-card">
      <a class="home-bw" href="#/history/progress/${BODYWEIGHT_KEY}">
        <div class="routine-name">${bw ? `${bw.lbs} lbs` : 'Not logged yet'}</div>
        <div class="muted small">${bw ? daysAgoText(bw.date) : 'Log it to see a chart over time'}</div>
      </a>
      <button class="btn secondary" data-home-action="log-bw">Log</button>
    </div>`;

  viewEl.innerHTML = hero + weekTiles + bestList + lastCard + bwCard;
}

viewEl.addEventListener('click', e => {
  if (!e.target.closest('[data-home-action="log-bw"]')) return;
  if (logBodyweightPrompt()) renderHome();
});
