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

function restSeconds() { return Store.settings.restSeconds; }
function setRestSeconds(v) { Store.setSetting('restSeconds', v); }
// Rest after this set: warm-ups can have their own (shorter) rest.
function restAfter(set) {
  const st = Store.settings;
  return set.warmup && st.warmupRestSeconds !== null ? st.warmupRestSeconds : st.restSeconds;
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

// Leg and hip exercises usually go up in bigger jumps than upper-body ones.
const LOWER_BODY = /squat|dead ?lift|rdl|leg|lunge|hip|glute|calf|step.?up|good ?morning|split/i;
const isLowerBody = name => LOWER_BODY.test(name);

// Whether to show plate loading for an exercise. You can switch it in the
// routine editor; until then it's guessed from the name.
function isBarbell(ex) {
  if (ex.type !== 'weight') return false;
  if (typeof ex.barbell === 'boolean') return ex.barbell;
  if (/dumbbell|\bdb\b|cable|machine|kettlebell|smith|band/i.test(ex.name)) return false;
  return /barbell|bench|squat|dead ?lift|press|row|clean|rdl|good ?morning|hip thrust|shrug/i.test(ex.name);
}

// What to put on each side of the bar, using the plates you own.
function platesText(weight) {
  const st = Store.settings;
  if (!weight) return '';
  if (weight < st.barWeight) return 'Less than the bar';
  let side = (weight - st.barWeight) / 2;
  if (side === 0) return 'Just the bar';
  const used = [];
  for (const p of [...st.plates].sort((a, b) => b - a)) {
    while (side >= p - 1e-9) { used.push(p); side -= p; }
  }
  const text = used.length ? `Each side: ${used.join(' + ')}` : 'Each side: —';
  return side > 1e-9 ? `${text} (${+(side * 2).toFixed(2)} lbs short)` : text;
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

// If you hit every target rep on every working set last time, suggest
// adding weight (when that's switched on in Settings).
// "2-3" → [2, 3]
const effortRange = text => String(text).split('-').map(Number);
const repsLeft = set => 10 - set.rpe; // saved as RPE; 10 = 0 reps left

// Whether to add weight this time, and a short reason shown under the exercise.
// Rules: hit every target rep last time, and (if you rated your sets) the
// early sets weren't harder than your aim. The last set is meant to be hard,
// so it doesn't count against you.
function progression(ex, last) {
  const st = Store.settings;
  if (!st.autoIncrease || ex.type !== 'weight' || !last) return { bump: 0, note: '' };
  const work = last.sets.filter(s => !s.warmup);
  if (!work.length) return { bump: 0, note: '' };
  const inc = isLowerBody(ex.name) ? st.incLower : st.incUpper;
  const missed = work.some(s => s.target?.reps && (s.reps ?? 0) < s.target.reps);
  if (missed) return { bump: 0, note: 'Same weight: hit all your target reps first' };
  if (!work.every(s => s.target?.reps)) return { bump: 0, note: '' };

  const early = work.slice(0, -1).filter(s => s.rpe);
  const lastSet = work[work.length - 1];
  if (st.askEffort) {
    const [minLeft] = effortRange(st.effortEarly);
    const tooHard = early.filter(s => repsLeft(s) < minLeft);
    if (tooHard.length) {
      return { bump: 0, note: `Same weight: your first sets had fewer than ${minLeft} reps left last time` };
    }
    const [, maxLastLeft] = effortRange(st.effortLast);
    const easyLast = lastSet.rpe && repsLeft(lastSet) > maxLastLeft + 1;
    if (easyLast) return { bump: inc, note: `↑ +${inc} lbs: even your last set had reps to spare` };
  } else if (work.filter(s => s.rpe).length) {
    const rated = work.filter(s => s.rpe);
    if (rated.reduce((n, s) => n + s.rpe, 0) / rated.length >= 9.5) return { bump: 0, note: 'Same weight: last time was all-out' };
  }
  return { bump: inc, note: `↑ +${inc} lbs: you hit every rep last time` };
}

// The type an exercise had the last time you did it or planned it.
function knownType(name) {
  const key = name.trim().toLowerCase();
  for (let i = Store.sessions.length - 1; i >= 0; i--) {
    const hit = Store.sessions[i].exercises.find(e => e.name.trim().toLowerCase() === key);
    if (hit) return hit.type;
  }
  for (const r of Store.routines) {
    const hit = r.exercises.find(e => e.name.trim().toLowerCase() === key);
    if (hit) return hit.type;
  }
  // Never done or planned: guess from the name.
  if (/plank|hold|hang|wall sit|carry/i.test(name)) return 'time';
  if (/push.?up|pull.?up|chin.?up|\bdips?\b|sit.?up|crunch|burpee|leg raise|lunge walk/i.test(name)) return 'bodyweight';
  return null;
}

// A new exercise for the workout in progress (from "Swap" or "Add").
// Uses last time's numbers when you've done it before.
function sessionExerciseFrom(name, plannedSets, fallbackType) {
  const type = knownType(name) || fallbackType || 'weight';
  const base = { id: Store.id(), name, type };
  const last = Store.lastPerformance(base);
  const targets = plannedSets?.length ? plannedSets
    : last ? last.sets.map(x => ({ warmup: x.warmup, reps: x.reps, weight: x.weight, seconds: x.seconds }))
    : [1, 2, 3].map(() => ({ warmup: false, reps: 8, weight: null, seconds: 60 }));
  const prev = last ? matchLastSets(last.sets, targets) : [];
  return {
    ...base,
    barbell: isBarbell(base),
    note: '',
    last,
    bump: 0,
    sets: targets.map((t, i) => ({
      warmup: t.warmup,
      target: null,
      reps: prev[i]?.reps ?? t.reps,
      weight: prev[i]?.weight ?? (type === 'weight' && plannedSets ? null : t.weight),
      seconds: prev[i]?.seconds ?? t.seconds,
      done: false,
    })),
  };
}

// Warm-up sets leading up to the first working set: bar × 10, then about
// 40%, 60% and 80% of the working weight, rounded to weights you can load.
function addWarmups(ex) {
  const work = ex.sets.find(x => !x.warmup);
  const top = work?.weight;
  if (!top) return alert('Enter the weight for your first working set first.');
  const st = Store.settings;
  const roundTo = 2 * Math.min(...st.plates, 5);
  const round = w => Math.round(w / roundTo) * roundTo;
  const steps = [[0, 10], [0.4, 5], [0.6, 3], [0.8, 2]];
  const weights = [];
  for (const [pct, reps] of steps) {
    const w = pct ? round(top * pct) : st.barWeight;
    if (w >= st.barWeight && w < top && !weights.some(x => x.weight === w)) weights.push({ weight: w, reps });
  }
  // Replace any warm-ups you haven't done yet.
  const keep = ex.sets.filter(x => !x.warmup || x.done);
  ex.sets = [
    ...weights.map(w => ({ warmup: true, target: null, reps: w.reps, weight: w.weight, seconds: null, done: false })),
    ...keep,
  ];
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
      const deload = inDeloadWeek() && ex.type === 'weight' ? Store.settings.deloadPercent : 0;
      const prog = deload ? { bump: 0, note: '' } : progression(ex, last);
      const bump = prog.bump;
      const step = Store.settings.weightStep;
      const lighter = w => (w == null ? w : Math.max(0, Math.round((w * deload) / 100 / step) * step));
      return {
        id: ex.id,
        name: ex.name,
        type: ex.type,
        barbell: isBarbell(ex),
        supersetNext: !!ex.supersetNext,
        note: '',
        last, // shown as "Last time: …" while logging; not saved into history
        bump, // extra weight suggested for working sets (0 = none)
        progressNote: prog.note,
        deload, // % of usual weight during a lighter week (0 = normal)
        sets: ex.sets.map((t, i) => {
          const p = prev[i]; // what you actually did last time, if anything
          const weight = p ? p.weight : t.weight;
          return {
            warmup: t.warmup,
            target: { reps: t.reps, weight: t.weight, seconds: t.seconds },
            reps: p ? p.reps : t.reps,
            weight: deload && !t.warmup ? lighter(weight) : bump && !t.warmup && weight != null ? weight + bump : weight,
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
  const step = Store.settings.weightStep;
  const weight = isTime ? '' : `
    <div class="stepper">
      <button data-w-action="step" data-dir="-1" ${attrs} aria-label="${step} pounds less">−</button>
      <input type="number" inputmode="decimal" min="0" step="any" data-w-field="weight" ${attrs} value="${s.weight ?? ''}" placeholder="${ex.type === 'bodyweight' ? '0' : ''}" aria-label="Pounds">
      <button data-w-action="step" data-dir="1" ${attrs} aria-label="${step} pounds more">+</button>
    </div>`;
  const target = s.target ? fmtSet(ex.type, s.target) : '—';
  const plates = ex.barbell ? `<div class="plates muted small" data-plates="${exIndex}-${setIndex}">${platesText(s.weight)}</div>` : '';
  return `
    <div class="log-row ${isTime ? 'timed' : ''} ${s.done ? 'done' : ''}">
      <span class="set-tag static ${s.warmup ? 'warm' : ''}">${s.warmup ? 'W' : workingNumber}</span>
      <span class="target">${target}</span>
      ${amount}
      ${weight}
      <button class="check ${s.done ? 'on' : ''}" data-w-action="done" ${attrs} aria-label="Mark set done" aria-pressed="${s.done}">✓</button>
      ${plates}
    </div>`;
}

// "Reps left in the tank" after a set: 0 = couldn't do another. Saved as
// RPE (10 = max effort), the usual way lifters log how hard a set was.
const RIR_CHOICES = [[6, '4+'], [7, '3'], [8, '2'], [9, '1'], [10, '0']];
// The reps-left aim for a set: the last working set is meant to be hardest.
function effortAim(ex, setIndex) {
  const st = Store.settings;
  const lastWorking = ex.sets.map((x, i) => (x.warmup ? -1 : i)).filter(i => i >= 0).pop();
  return effortRange(Number(setIndex) === lastWorking ? st.effortLast : st.effortEarly);
}

function effortRow(ex, exIndex, setIndex, s) {
  if (!s.done || s.warmup || !Store.settings.askEffort) return '';
  const [lo, hi] = effortAim(ex, setIndex);
  const inAim = rpe => { const left = 10 - rpe; return left >= lo && (left <= hi || (hi >= 4 && left >= 4)); };
  return `
    <div class="effort-row" data-effort-for="${exIndex}-${setIndex}">
      <span class="muted small">Reps left?<br><span class="aim">aim ${lo}–${hi}</span></span>
      ${RIR_CHOICES.map(([rpe, label]) => `
        <button class="${s.rpe === rpe ? 'on' : ''} ${inAim(rpe) ? 'aimed' : ''}" data-w-action="effort" data-ex="${exIndex}" data-set="${setIndex}" data-rpe="${rpe}" aria-pressed="${s.rpe === rpe}" aria-label="${label} reps left${inAim(rpe) ? ' (your aim)' : ''}">${label}</button>`).join('')}
    </div>`;
}

function sessionExerciseCard(ex, i, all) {
  const prev = all[i - 1], next = all[i + 1];
  const tools = `
    <div class="ex-tools">
      <button class="icon-btn" data-w-action="move" data-dir="-1" data-ex="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(ex.name)} up">↑</button>
      <button class="icon-btn" data-w-action="move" data-dir="1" data-ex="${i}" ${i === all.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(ex.name)} down">↓</button>
      <button class="icon-btn" data-w-action="more" data-ex="${i}" aria-expanded="${!!ex.showTools}" aria-label="More options for ${esc(ex.name)}">⋯</button>
    </div>`;

  if (ex.skipped) {
    return `
      <div class="card exercise skipped">
        <div class="ex-head-row"><div class="ex-title">${esc(ex.name)}</div>
          <button class="link-btn" data-w-action="skip" data-ex="${i}">Undo skip</button></div>
        <div class="muted small">Skipped today. It won't be saved.</div>
      </div>`;
  }

  let working = 0;
  const isTime = ex.type === 'time';
  const lastWork = ex.last ? ex.last.sets.filter(s => !s.warmup) : [];
  const lastLine = ex.last
    ? `Last time (${shortDate(ex.last.date)}): ${(lastWork.length ? lastWork : ex.last.sets).map(s => fmtSet(ex.type, s)).join(', ')}`
    : 'First time doing this one';
  const bumpLine = ex.progressNote ? `<div class="${ex.bump ? 'bump-line' : 'hold-line muted'} small">${esc(ex.progressNote)}</div>`
    : ex.bump ? `<div class="bump-line small">↑ +${ex.bump} lbs: you hit every rep last time</div>` : '';
  const deloadLine = ex.deload ? `<div class="bump-line small">↓ Lighter week: working sets at ${ex.deload}%</div>` : '';
  const pinned = Store.exerciseNote(ex.name);
  const pinLine = pinned ? `<button class="pin-note" data-w-action="pin" data-ex="${i}"><span aria-hidden="true">📌</span> ${esc(pinned)}</button>` : '';
  const superset = ex.supersetNext && next && !next.skipped ? `Superset with ${esc(next.name)}: no rest until after it`
    : prev?.supersetNext && !prev.skipped ? `Superset with ${esc(prev.name)}` : '';
  const head = isTime
    ? '<span>Set</span><span>Target</span><span>Secs</span><span></span>'
    : `<span>Set</span><span>Target</span><span>Reps</span><span>${ex.type === 'bodyweight' ? '+ lbs' : 'lbs'}</span><span></span>`;
  const more = ex.showTools ? `
    <div class="tool-row">
      <button class="link-btn" data-w-action="swap" data-ex="${i}">Swap exercise</button>
      <button class="link-btn" data-w-action="skip" data-ex="${i}">Skip today</button>
      ${ex.type === 'weight' ? `<button class="link-btn" data-w-action="warmups" data-ex="${i}">Add warm-ups</button>` : ''}
      <button class="link-btn" data-w-action="pin" data-ex="${i}">${pinned ? 'Edit pinned note' : 'Pin a note'}</button>
    </div>` : '';
  return `
    <div class="card exercise ${superset ? 'in-superset' : ''}">
      ${superset ? `<div class="superset-tag">${superset}</div>` : ''}
      <div class="ex-head-row"><div class="ex-title">${esc(ex.name)}</div>${tools}</div>
      ${more}
      ${pinLine}
      <div class="muted small last-line">${lastLine}</div>
      ${bumpLine}${deloadLine}
      <div class="log-row head ${isTime ? 'timed' : ''}">${head}</div>
      ${ex.sets.map((s, j) => logRow(ex, i, s, j, s.warmup ? '' : ++working) + effortRow(ex, i, j, s)).join('')}
      <button class="link-btn" data-w-action="add-set" data-ex="${i}">+ Add set</button>
      <input class="ex-note" data-w-field="note" data-ex="${i}" value="${esc(ex.note)}" placeholder="Note for today (optional)" aria-label="Note for ${esc(ex.name)}">
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
    ${s.exercises.map((ex, i, all) => sessionExerciseCard(ex, i, all)).join('')}
    <button class="btn secondary block" data-w-action="add-ex">+ Add an exercise</button>
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
  if (field === 'weight') {
    const p = viewEl.querySelector(`[data-plates="${t.dataset.ex}-${t.dataset.set}"]`);
    if (p) p.textContent = platesText(t.value === '' ? null : Number(t.value));
  }
});

viewEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-w-action]');
  if (!btn) return;
  const action = btn.dataset.wAction;
  if (action === 'start') {
    startWorkout(btn.dataset.id);
    if (!location.hash.startsWith('#/workout')) location.hash = '#/workout'; // started from Home
    return;
  }

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
      const row = btn.closest('.log-row');
      row.classList.toggle('done', set.done);
      // Show or hide the "reps left" question under this set.
      viewEl.querySelector(`[data-effort-for="${btn.dataset.ex}-${btn.dataset.set}"]`)?.remove();
      if (set.done) row.insertAdjacentHTML('afterend', effortRow(ex, btn.dataset.ex, btn.dataset.set, set));
      unlockSound(); // phones only allow sound that follows a tap
      // In a superset, rest only after the last exercise of the pair.
      const next = s.exercises[Number(btn.dataset.ex) + 1];
      const rest = ex.supersetNext && next && !next.skipped ? 0 : restAfter(set);
      if (set.done && rest) restEndsAt = Date.now() + rest * 1000;
      tick();
      return;
    }
    case 'effort': {
      const set = ex.sets[btn.dataset.set];
      const rpe = Number(btn.dataset.rpe);
      set.rpe = set.rpe === rpe ? null : rpe;
      Store.setActive(s);
      btn.parentElement.querySelectorAll('button').forEach(b => {
        const on = Number(b.dataset.rpe) === set.rpe;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
      });
      return;
    }
    case 'move': {
      const i = Number(btn.dataset.ex), j = i + Number(btn.dataset.dir);
      [s.exercises[i], s.exercises[j]] = [s.exercises[j], s.exercises[i]];
      break;
    }
    case 'more':
      ex.showTools = !ex.showTools;
      break;
    case 'skip':
      ex.skipped = !ex.skipped;
      ex.showTools = false;
      break;
    case 'swap': {
      const name = prompt(`Swap ${ex.name} for which exercise?`, '')?.trim();
      if (!name) return;
      s.exercises[btn.dataset.ex] = sessionExerciseFrom(name, ex.sets.map(x => ({ ...x, done: false })), ex.type);
      break;
    }
    case 'add-ex': {
      const name = prompt('Which exercise do you want to add?', '')?.trim();
      if (!name) return;
      s.exercises.push(sessionExerciseFrom(name, null, null));
      break;
    }
    case 'warmups':
      addWarmups(ex);
      ex.showTools = false;
      break;
    case 'pin': {
      const text = prompt(`Pinned note for ${ex.name} (shows every time you do it). Leave empty to remove.`, Store.exerciseNote(ex.name));
      if (text === null) return;
      Store.setExerciseNote(ex.name, text);
      ex.showTools = false;
      break;
    }
    case 'step': {
      const set = ex.sets[btn.dataset.set];
      const next = Math.max(0, +((set.weight || 0) + Number(btn.dataset.dir) * Store.settings.weightStep).toFixed(2));
      set.weight = next;
      Store.setActive(s);
      const input = btn.parentElement.querySelector('input');
      input.value = next; // update in place so the page doesn't jump
      const p = viewEl.querySelector(`[data-plates="${btn.dataset.ex}-${btn.dataset.set}"]`);
      if (p) p.textContent = platesText(next);
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
    const how = Store.settings.restAlert;
    if (how !== 'sound') navigator.vibrate?.([200, 100, 200]); // Android only; iPhones ignore it
    if (how !== 'vibrate') beep();
  }
}

/* ---------- Rest alert sound ---------- */

let audio = null;
function unlockSound() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {}
}
function beep() {
  if (!audio) return;
  const t0 = audio.currentTime;
  [0, 0.25, 0.5].forEach(offset => { // three short beeps
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.2);
  });
}

/* ---------- Keep the screen on during a workout ---------- */

let wakeLock = null, askingForWake = false;
async function updateWakeLock() {
  const want = !!Store.active && Store.settings.keepAwake && document.visibilityState === 'visible';
  if (want && !wakeLock && !askingForWake && 'wakeLock' in navigator) {
    askingForWake = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {} // not supported or not allowed right now; tried again next second
    askingForWake = false;
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
setInterval(updateWakeLock, 1000);
setInterval(tick, 1000);

// Small green dot on the Workout tab while a workout is in progress.
function updateWorkoutDot() {
  document.querySelector('.tabbar a[data-tab="workout"]').classList.toggle('live', !!Store.active);
}
updateWorkoutDot();
