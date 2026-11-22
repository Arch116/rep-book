// Workout tab: pick a routine, log each set, optional rest timer, finish.

/* ---------- Small helpers ---------- */

const REST_CHOICES = [60, 90, 120, 180, 0]; // seconds; 0 = timer off
// When the current rest countdown ends (or null). Remembered across reloads,
// since phones sometimes reload a page after the screen locks.
let restEndsAt = (() => {
  try { return Number(localStorage.getItem('workout-rest-ends')) || null; } catch { return null; }
})();
function saveRestEnd() {
  try {
    if (restEndsAt) localStorage.setItem('workout-rest-ends', String(restEndsAt));
    else localStorage.removeItem('workout-rest-ends');
  } catch {}
}
let toastText = null;    // one-time message such as "Workout saved"

function restSeconds() {
  try {
    const raw = localStorage.getItem('workout-rest-seconds');
    if (raw === null) return 90;
    const v = Number(raw);
    return REST_CHOICES.includes(v) ? v : 90;
  } catch { return 90; }
}
function setRestSeconds(v) {
  try { localStorage.setItem('workout-rest-seconds', String(v)); } catch {}
}

const shortDate = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const clock = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const mmss = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

// How a set reads in text, e.g. "8 × 135", "10 +25", "60s".
function fmtSet(type, s) {
  if (type === 'time') return `${s.seconds ?? '–'}s`;
  if (type === 'bodyweight') return `${s.reps ?? '–'}${s.weight ? ` +${s.weight}` : ''}`;
  return `${s.reps ?? '–'} × ${s.weight ?? '–'}`;
}

/* ---------- Starting a workout ---------- */

// Line up last time's sets with today's: 1st warm-up with 1st warm-up,
// 1st working set with 1st working set, and so on.
function matchLastSets(lastSets, routineSets) {
  const pools = { warm: lastSets.filter(s => s.warmup), work: lastSets.filter(s => !s.warmup) };
  const used = { warm: 0, work: 0 };
  return routineSets.map(t => {
    const k = t.warmup ? 'warm' : 'work';
    return pools[k][used[k]++] || null;
  });
}

function startWorkout(routineId) {
  const r = Store.getRoutine(routineId);
  if (!r) return;
  const session = {
    id: Store.id(),
    routineId: r.id,
    routineName: r.name,
    startedAt: new Date().toISOString(),
    notes: '',
    exercises: r.exercises.map(ex => {
      const last = Store.lastPerformance(ex);
      const prev = last ? matchLastSets(last.sets, ex.sets) : [];
      return {
        id: ex.id,
        name: ex.name,
        type: ex.type,
        note: '',
        last, // shown as "Last time: …" while logging; not saved into history
        sets: ex.sets.map((t, i) => {
          const p = prev[i]; // what you actually did last time, if anything
          return {
            warmup: t.warmup,
            target: { reps: t.reps, weight: t.weight, seconds: t.seconds },
            reps: p ? p.reps : t.reps,
            weight: p ? p.weight : t.weight,
            seconds: p ? p.seconds : t.seconds,
            done: false,
          };
        }),
      };
    }),
  };
  Store.setActive(session);
  restEndsAt = null;
  renderWorkout();
  window.scrollTo(0, 0);
  updateWorkoutDot();
}

/* ---------- Screens ---------- */

function renderWorkout() {
  titleEl.textContent = 'Workout';
  if (Store.active) return renderSession(Store.active);

  const toast = toastText ? `<div class="toast">${esc(toastText)}</div>` : '';
  toastText = null;
  const routines = Store.routines;
  if (!routines.length) {
    viewEl.innerHTML = `${toast}
      <div class="empty">
        <p>Create a routine first, then start it here.</p>
        <a class="btn" href="#/routines/new">New routine</a>
      </div>`;
    return;
  }
  viewEl.innerHTML = `${toast}
    <p class="muted small hint">Choose a routine to start.</p>
    ${routines.map(r => `
      <button class="card routine-card" data-w-action="start" data-id="${r.id}">
        <div>
          <div class="routine-name">${esc(r.name)}</div>
          <div class="muted">${routineSummary(r)}</div>
        </div>
        <span class="start-pill">Start</span>
      </button>`).join('')}`;
}

function logRow(ex, exIndex, s, setIndex, workingNumber) {
  const isTime = ex.type === 'time';
  const attrs = `data-ex="${exIndex}" data-set="${setIndex}"`;
  const amount = isTime
    ? `<input type="number" inputmode="numeric" min="0" data-w-field="seconds" ${attrs} value="${s.seconds ?? ''}" aria-label="Seconds">`
    : `<input type="number" inputmode="numeric" min="0" data-w-field="reps" ${attrs} value="${s.reps ?? ''}" aria-label="Reps">`;
  const weight = isTime ? '' :
    `<input type="number" inputmode="decimal" min="0" step="any" data-w-field="weight" ${attrs} value="${s.weight ?? ''}" placeholder="${ex.type === 'bodyweight' ? '0' : ''}" aria-label="Pounds">`;
  const target = s.target ? fmtSet(ex.type, s.target) : '—';
  return `
    <div class="log-row ${isTime ? 'timed' : ''} ${s.done ? 'done' : ''}">
      <span class="set-tag static ${s.warmup ? 'warm' : ''}">${s.warmup ? 'W' : workingNumber}</span>
      <span class="target">${target}</span>
      ${amount}
      ${weight}
      <button class="check ${s.done ? 'on' : ''}" data-w-action="done" ${attrs} aria-label="Mark set done" aria-pressed="${s.done}">✓</button>
    </div>`;
}

function sessionExerciseCard(ex, i) {
  let working = 0;
  const isTime = ex.type === 'time';
  const lastWork = ex.last ? ex.last.sets.filter(s => !s.warmup) : [];
  const lastLine = ex.last
    ? `Last time (${shortDate(ex.last.date)}): ${(lastWork.length ? lastWork : ex.last.sets).map(s => fmtSet(ex.type, s)).join(', ')}`
    : 'First time doing this one';
  const head = isTime
    ? '<span>Set</span><span>Target</span><span>Secs</span><span></span>'
    : `<span>Set</span><span>Target</span><span>Reps</span><span>${ex.type === 'bodyweight' ? '+ lbs' : 'lbs'}</span><span></span>`;
  return `
    <div class="card exercise">
      <div class="ex-title">${esc(ex.name)}</div>
      <div class="muted small last-line">${lastLine}</div>
      <div class="log-row head ${isTime ? 'timed' : ''}">${head}</div>
      ${ex.sets.map((s, j) => logRow(ex, i, s, j, s.warmup ? '' : ++working)).join('')}
      <button class="link-btn" data-w-action="add-set" data-ex="${i}">+ Add set</button>
      <input class="ex-note" data-w-field="note" data-ex="${i}" value="${esc(ex.note)}" placeholder="Note (optional)" aria-label="Note for ${esc(ex.name)}">
    </div>`;
}

function renderSession(s) {
  const rest = restSeconds();
  viewEl.innerHTML = `
    <div class="session-head">
      <div>
        <div class="routine-name">${esc(s.routineName)}</div>
        <div class="muted small">Started ${clock(s.startedAt)} · <span data-elapsed></span></div>
      </div>
      <button class="chip" data-w-action="rest-cycle" aria-label="Change rest timer">Rest: ${rest ? mmss(rest) : 'off'}</button>
    </div>
    ${s.exercises.map(sessionExerciseCard).join('')}
    <label class="field">
      <span>Workout notes</span>
      <textarea data-w-field="notes" rows="3" placeholder="How did it feel? Anything to remember next time?">${esc(s.notes)}</textarea>
    </label>
    <div class="editor-actions">
      <button class="btn block" data-w-action="finish">Finish workout</button>
      <button class="btn danger block" data-w-action="discard">Discard workout</button>
    </div>`;
  tick();
}

/* ---------- Typing and tapping ---------- */

viewEl.addEventListener('input', e => {
  const t = e.target;
  const field = t.dataset.wField;
  const s = Store.active;
  if (!field || !s) return;
  if (field === 'notes') s.notes = t.value;
  else if (field === 'note') s.exercises[t.dataset.ex].note = t.value;
  else s.exercises[t.dataset.ex].sets[t.dataset.set][field] = t.value === '' ? null : Number(t.value);
  Store.setActive(s);
});

viewEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-w-action]');
  if (!btn) return;
  const action = btn.dataset.wAction;
  if (action === 'start') return startWorkout(btn.dataset.id);

  const s = Store.active;
  if (!s) return;
  const ex = s.exercises[btn.dataset.ex];

  switch (action) {
    case 'done': {
      const set = ex.sets[btn.dataset.set];
      set.done = !set.done;
      Store.setActive(s);
      // Update just this row so the page doesn't jump.
      btn.classList.toggle('on', set.done);
      btn.setAttribute('aria-pressed', set.done);
      btn.closest('.log-row').classList.toggle('done', set.done);
      if (set.done && restSeconds()) restEndsAt = Date.now() + restSeconds() * 1000;
      tick();
      return;
    }
    case 'add-set': {
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push({
        warmup: false, target: null,
        reps: last?.reps ?? null, weight: last?.weight ?? null, seconds: last?.seconds ?? null,
        done: false,
      });
      break;
    }
    case 'rest-cycle': {
      const next = REST_CHOICES[(REST_CHOICES.indexOf(restSeconds()) + 1) % REST_CHOICES.length];
      setRestSeconds(next);
      if (!next) restEndsAt = null;
      break;
    }
    case 'finish': {
      const all = s.exercises.flatMap(x => x.sets);
      const done = all.filter(x => x.done).length;
      if (!done) {
        alert('Tick off at least one set before finishing (or discard the workout).');
        return;
      }
      const skipped = all.length - done;
      if (skipped && !confirm(`${skipped} set${skipped === 1 ? ' isn’t' : 's aren’t'} ticked off and won’t be saved. Finish anyway?`)) return;
      const saved = Store.finishActive();
      restEndsAt = null;
      toastText = `Saved ${saved.routineName}: ${done} set${done === 1 ? '' : 's'}. Nice work.`;
      renderWorkout();
      window.scrollTo(0, 0);
      updateWorkoutDot();
      tick();
      return;
    }
    case 'discard':
      if (!confirm('Discard this workout? Nothing from it will be saved.')) return;
      Store.setActive(null);
      restEndsAt = null;
      renderWorkout();
      updateWorkoutDot();
      tick();
      return;
    default:
      return;
  }
  Store.setActive(s);
  renderSession(s);
});

/* ---------- Rest timer bar and elapsed time ---------- */

const restBar = document.getElementById('rest-bar');

restBar.addEventListener('click', e => {
  const btn = e.target.closest('[data-rest]');
  if (!btn || !restEndsAt) return;
  const change = btn.dataset.rest;
  if (change === 'skip') restEndsAt = null;
  else restEndsAt = Math.max(Date.now(), restEndsAt) + Number(change) * 1000;
  tick();
});

let buzzed = false;
function tick() {
  if (!Store.active) restEndsAt = null;
  if (restEndsAt && Date.now() - restEndsAt > 60000) restEndsAt = null; // hide a minute after it ends
  saveRestEnd();

  // Elapsed time in the session header.
  const el = viewEl.querySelector('[data-elapsed]');
  if (el && Store.active) {
    const mins = Math.floor((Date.now() - new Date(Store.active.startedAt)) / 60000);
    el.textContent = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  }

  // Rest countdown.
  if (!restEndsAt) {
    restBar.hidden = true;
    buzzed = false;
    return;
  }
  const left = Math.ceil((restEndsAt - Date.now()) / 1000);
  restBar.hidden = false;
  restBar.classList.toggle('over', left <= 0);
  restBar.querySelector('.rest-time').textContent = left > 0 ? `Rest ${mmss(left)}` : 'Rest over. Next set!';
  if (left <= 0 && !buzzed) {
    buzzed = true;
    navigator.vibrate?.([200, 100, 200]); // works on Android; iPhones ignore it
  }
}
setInterval(tick, 1000);

// Small green dot on the Workout tab while a workout is in progress.
function updateWorkoutDot() {
  document.querySelector('.tabbar a[data-tab="workout"]').classList.toggle('live', !!Store.active);
}
updateWorkoutDot();
