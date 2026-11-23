// History tab: list of finished workouts, and the details of one workout.

const longDate = iso => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const monthLabel = iso => new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function durationText(s) {
  if (!s.finishedAt) return '';
  const mins = Math.round((new Date(s.finishedAt) - new Date(s.startedAt)) / 60000);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

// The standout set for an exercise: heaviest for weights, most reps for
// bodyweight, longest for timed. Warm-ups don't count.
function bestSet(ex) {
  const sets = ex.sets.filter(s => !s.warmup);
  const pool = sets.length ? sets : ex.sets;
  const score = s =>
    ex.type === 'time' ? (s.seconds || 0) :
    ex.type === 'bodyweight' ? (s.weight || 0) * 1000 + (s.reps || 0) :
    (s.weight || 0) * 1000 + (s.reps || 0);
  return pool.reduce((best, s) => (score(s) > score(best) ? s : best), pool[0]);
}

// Total pounds moved (reps × weight) across working sets with weight.
function volume(session) {
  return session.exercises
    .filter(ex => ex.type !== 'time')
    .flatMap(ex => ex.sets.filter(s => !s.warmup))
    .reduce((sum, s) => sum + (s.reps || 0) * (s.weight || 0), 0);
}

function renderHistory(sessionId, extra) {
  if (sessionId === 'progress') return renderProgress(extra);
  if (sessionId) return renderSessionDetail(sessionId);

  const sessions = [...Store.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!sessions.length) {
    viewEl.innerHTML = `${historySwitch('workouts')}
      <div class="empty">
        <p>No workouts yet.<br>Finish a workout and it will show up here.</p>
        <a class="btn" href="#/workout">Start a workout</a>
      </div>`;
    return;
  }

  let html = historySwitch('workouts');
  let month = '';
  for (const s of sessions) {
    const m = monthLabel(s.startedAt);
    if (m !== month) {
      html += `<h2 class="section-label">${m}</h2>`;
      month = m;
    }
    const setCount = s.exercises.reduce((n, ex) => n + ex.sets.filter(x => !x.warmup).length, 0);
    const highlights = s.exercises.map(ex => `${esc(ex.name)} ${fmtSet(ex.type, bestSet(ex))}`).join(' · ');
    html += `
      <a class="card routine-card" href="#/history/${s.id}">
        <div>
          <div class="history-top">
            <span class="routine-name">${esc(s.routineName)}</span>
            <span class="muted small">${longDate(s.startedAt)}</span>
          </div>
          <div class="muted">${setCount} working set${setCount === 1 ? '' : 's'}${s.finishedAt ? ` · ${durationText(s)}` : ''}</div>
          <div class="muted small">${highlights}</div>
        </div>
        <span class="chevron" aria-hidden="true">›</span>
      </a>`;
  }
  viewEl.innerHTML = html;
}

function renderSessionDetail(sessionId) {
  const s = Store.sessions.find(x => x.id === sessionId);
  if (!s) { location.hash = '#/history'; return; }

  const vol = volume(s);
  const stats = [
    `${longDate(s.startedAt)}, ${clock(s.startedAt)}`,
    durationText(s),
    vol ? `${vol.toLocaleString()} lbs total` : '',
  ].filter(Boolean).join(' · ');

  const cards = s.exercises.map(ex => {
    const isTime = ex.type === 'time';
    let working = 0;
    const rows = ex.sets.map(set => `
      <div class="detail-row ${isTime ? 'timed' : ''}">
        <span class="set-tag static ${set.warmup ? 'warm' : ''}">${set.warmup ? 'W' : ++working}</span>
        ${isTime
          ? `<span>${set.seconds ?? '–'} sec</span>`
          : `<span>${set.reps ?? '–'} reps</span><span>${ex.type === 'bodyweight'
              ? (set.weight ? `+${set.weight} lbs` : 'bodyweight')
              : `${set.weight ?? '–'} lbs`}</span>`}
        <span class="muted small">${[set.target ? `target ${fmtSet(ex.type, set.target)}` : '', set.rpe ? `${10 - set.rpe === 4 ? '4+' : 10 - set.rpe} left` : ''].filter(Boolean).join(' · ')}</span>
      </div>`).join('');
    return `
      <div class="card exercise">
        <div class="ex-title">${esc(ex.name)}</div>
        ${ex.note ? `<div class="note-text">${esc(ex.note)}</div>` : ''}
        <div class="detail-rows">${rows}</div>
      </div>`;
  }).join('');

  viewEl.innerHTML = `
    <a class="back-link" href="#/history">‹ History</a>
    ${screenTitle(s.routineName)}
    <p class="muted small hint">${stats}</p>
    ${s.notes ? `<div class="card"><div class="muted small">Notes</div><div class="note-text">${esc(s.notes)}</div></div>` : ''}
    ${cards}
    <div class="editor-actions">
      <button class="btn danger block" data-h-action="delete" data-id="${s.id}">Delete this workout</button>
    </div>`;
}

viewEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-h-action="delete"]');
  if (!btn) return;
  if (!confirm('Delete this workout from your history? This can’t be undone.')) return;
  Store.deleteSession(btn.dataset.id);
  location.hash = '#/history';
});
