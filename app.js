// App: decides which screen to show based on the address (#/routines, etc.)
// and draws it into the <main id="view"> area.

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('page-title');

// Makes typed text safe to put inside the page.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPES = { weight: 'Weight', bodyweight: 'Bodyweight', time: 'Timed' };

const newSet = prev => prev ? { ...prev } : { warmup: false, reps: 8, weight: null, seconds: 60 };
const newExercise = () => ({ id: Store.id(), name: '', type: 'weight', sets: [newSet()] });

function routineSummary(r) {
  const sets = r.exercises.flatMap(ex => ex.sets);
  const warm = sets.filter(s => s.warmup).length;
  const ex = r.exercises.length;
  let text = `${ex} exercise${ex === 1 ? '' : 's'} · ${sets.length - warm} working set${sets.length - warm === 1 ? '' : 's'}`;
  if (warm) text += ` + ${warm} warm-up`;
  return text;
}

/* ---------- Routines list ---------- */

function renderRoutineList() {
  titleEl.textContent = 'Routines';
  const routines = Store.routines;
  if (!routines.length) {
    viewEl.innerHTML = `
      <div class="empty">
        <p>No routines yet.<br>Create one like Push, Pull, Deadlift or Squat.</p>
        <a class="btn" href="#/routines/new">New routine</a>
      </div>`;
    return;
  }
  viewEl.innerHTML = `
    ${routines.map(r => `
      <a class="card routine-card" href="#/routines/${r.id}">
        <div>
          <div class="routine-name">${esc(r.name)}</div>
          <div class="muted">${routineSummary(r)}</div>
          <div class="muted small">${r.exercises.map(ex => esc(ex.name)).join(' · ')}</div>
        </div>
        <span class="chevron" aria-hidden="true">›</span>
      </a>`).join('')}
    <a class="btn secondary block" href="#/routines/new">+ New routine</a>`;
}

/* ---------- Routine editor ---------- */
// While editing we work on a copy ("draft"). Nothing is saved until you tap Save.

let draft = null;
let draftIsNew = false;

function openEditor(routineId) {
  if (routineId === 'new') {
    draft = { id: Store.id(), name: '', exercises: [newExercise()] };
    draftIsNew = true;
    history.replaceState(null, '', `#/routines/${draft.id}`);
  } else if (!draft || draft.id !== routineId) {
    const existing = Store.getRoutine(routineId);
    if (!existing) { location.hash = '#/routines'; return; }
    draft = structuredClone(existing);
    draftIsNew = false;
  }
  renderEditor();
}

function setRow(ex, exIndex, set, setIndex, workingNumber) {
  const isTime = ex.type === 'time';
  const amount = isTime
    ? `<input type="number" inputmode="numeric" min="0" data-field="seconds" data-ex="${exIndex}" data-set="${setIndex}" value="${set.seconds ?? ''}" aria-label="Seconds">`
    : `<input type="number" inputmode="numeric" min="0" data-field="reps" data-ex="${exIndex}" data-set="${setIndex}" value="${set.reps ?? ''}" aria-label="Reps">`;
  const weight = isTime ? '' :
    `<input type="number" inputmode="decimal" min="0" step="any" data-field="weight" data-ex="${exIndex}" data-set="${setIndex}" value="${set.weight ?? ''}" placeholder="${ex.type === 'bodyweight' ? '0' : ''}" aria-label="${ex.type === 'bodyweight' ? 'Added weight in pounds' : 'Weight in pounds'}">`;
  return `
    <div class="set-row ${isTime ? 'timed' : ''}">
      <button class="set-tag ${set.warmup ? 'warm' : ''}" data-action="toggle-warm" data-ex="${exIndex}" data-set="${setIndex}"
        aria-label="${set.warmup ? 'Warm-up set, tap to make it a working set' : 'Working set, tap to make it a warm-up'}">${set.warmup ? 'W' : workingNumber}</button>
      ${amount}
      ${weight}
      <button class="icon-btn" data-action="remove-set" data-ex="${exIndex}" data-set="${setIndex}" aria-label="Remove set">×</button>
    </div>`;
}

function exerciseCard(ex, i, count) {
  let working = 0;
  const rows = ex.sets.map((s, j) => setRow(ex, i, s, j, s.warmup ? '' : ++working)).join('');
  const isTime = ex.type === 'time';
  const headers = isTime
    ? '<span>Set</span><span>Seconds</span><span></span>'
    : `<span>Set</span><span>Reps</span><span>${ex.type === 'bodyweight' ? '+ lbs' : 'lbs'}</span><span></span>`;
  return `
    <div class="card exercise">
      <div class="ex-head">
        <input class="ex-name" data-field="ex-name" data-ex="${i}" value="${esc(ex.name)}" placeholder="Exercise name" aria-label="Exercise name">
        <button class="icon-btn" data-action="move-up" data-ex="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button class="icon-btn" data-action="move-down" data-ex="${i}" ${i === count - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        <button class="icon-btn" data-action="remove-ex" data-ex="${i}" aria-label="Remove exercise">×</button>
      </div>
      <div class="seg" role="group" aria-label="Exercise type">
        ${Object.entries(TYPES).map(([key, label]) => `
          <button data-action="type" data-ex="${i}" data-type="${key}" class="${ex.type === key ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <div class="set-row head ${isTime ? 'timed' : ''}">${headers}</div>
      ${rows}
      <button class="link-btn" data-action="add-set" data-ex="${i}">+ Add set</button>
    </div>`;
}

function renderEditor() {
  titleEl.textContent = draftIsNew ? 'New routine' : 'Edit routine';
  viewEl.innerHTML = `
    <label class="field">
      <span>Routine name</span>
      <input data-field="name" value="${esc(draft.name)}" placeholder="e.g. Push">
    </label>
    <p class="muted small hint">Tap a set number to mark it as a warm-up (W).</p>
    ${draft.exercises.map((ex, i) => exerciseCard(ex, i, draft.exercises.length)).join('')}
    <button class="btn secondary block" data-action="add-ex">+ Add exercise</button>
    <div class="editor-actions">
      <button class="btn block" data-action="save">Save routine</button>
      <a class="btn secondary block" href="#/routines">Cancel</a>
      ${draftIsNew ? '' : '<button class="btn danger block" data-action="delete-routine">Delete routine</button>'}
    </div>`;
}

// Typing in a box updates the draft without redrawing (so the keyboard stays open).
viewEl.addEventListener('input', e => {
  const t = e.target;
  const field = t.dataset.field;
  if (!draft || !field) return;
  const ex = draft.exercises[t.dataset.ex];
  if (field === 'name') draft.name = t.value;
  else if (field === 'ex-name') ex.name = t.value;
  else ex.sets[t.dataset.set][field] = t.value === '' ? null : Number(t.value);
});

viewEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || !draft) return;
  const ex = draft.exercises[btn.dataset.ex];
  const i = Number(btn.dataset.ex);
  let focusSelector = null;

  switch (btn.dataset.action) {
    case 'add-ex':
      draft.exercises.push(newExercise());
      focusSelector = `[data-field="ex-name"][data-ex="${draft.exercises.length - 1}"]`;
      break;
    case 'remove-ex':
      if (ex.name && !confirm(`Remove ${ex.name}?`)) return;
      draft.exercises.splice(i, 1);
      break;
    case 'move-up':
      [draft.exercises[i - 1], draft.exercises[i]] = [draft.exercises[i], draft.exercises[i - 1]];
      break;
    case 'move-down':
      [draft.exercises[i + 1], draft.exercises[i]] = [draft.exercises[i], draft.exercises[i + 1]];
      break;
    case 'type':
      ex.type = btn.dataset.type;
      break;
    case 'add-set': {
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push({ ...newSet(last), warmup: false }); // copies the last set's numbers
      break;
    }
    case 'remove-set':
      ex.sets.splice(Number(btn.dataset.set), 1);
      break;
    case 'toggle-warm': {
      const s = ex.sets[btn.dataset.set];
      s.warmup = !s.warmup;
      break;
    }
    case 'save':
      return saveDraft();
    case 'delete-routine':
      if (!confirm(`Delete the "${draft.name}" routine? This can't be undone.`)) return;
      Store.deleteRoutine(draft.id);
      draft = null;
      location.hash = '#/routines';
      return;
    default:
      return;
  }
  renderEditor();
  if (focusSelector) viewEl.querySelector(focusSelector)?.focus();
});

function saveDraft() {
  draft.name = draft.name.trim();
  draft.exercises.forEach(ex => { ex.name = ex.name.trim(); });
  if (!draft.name) {
    alert('Give the routine a name first.');
    viewEl.querySelector('[data-field="name"]').focus();
    return;
  }
  const unnamed = draft.exercises.findIndex(ex => !ex.name);
  if (unnamed >= 0) {
    alert('Give every exercise a name (or remove it).');
    viewEl.querySelector(`[data-field="ex-name"][data-ex="${unnamed}"]`).focus();
    return;
  }
  Store.saveRoutine(draft);
  draft = null;
  location.hash = '#/routines';
}

/* ---------- Placeholder screens ---------- */

/* ---------- Router ---------- */

function route() {
  const [tab, param] = location.hash.replace('#/', '').split('/');
  const name = ['routines', 'workout', 'history'].includes(tab) ? tab : 'routines';

  if (!(name === 'routines' && param)) draft = null; // leaving the editor discards the draft

  if (name === 'routines' && param) openEditor(param);
  else if (name === 'routines') renderRoutineList();
  else if (name === 'workout') renderWorkout();
  else renderHistory(param);

  document.querySelectorAll('.tabbar a').forEach(a =>
    a.classList.toggle('active', a.dataset.tab === name));
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
// Wait until every script file has loaded (workout.js comes after this one).
window.addEventListener('DOMContentLoaded', route);
