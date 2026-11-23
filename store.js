// Store: the one place that saves and loads data.
// Everything is always saved in this browser first (so the app works with no
// signal). When you're signed in, sync.js copies it to and from Supabase so
// your phone and laptop share the same data.

const Store = (() => {
  const KEY = 'workout-app-v1';

  // Shape of everything we save:
  // routines: [{ id, name, updatedAt, exercises: [{ id, name, type, sets: [{ warmup, reps, weight, seconds }] }] }]
  //   type is 'weight' | 'bodyweight' | 'time'
  // sessions: [{ id, routineId, routineName, startedAt, finishedAt, notes,
  //              exercises: [{ id, name, type, note, sets: [{ warmup, target, reps, weight, seconds, done }] }] }]
  // active: the workout in progress (same shape as a session), or null
  // activeChangedAt: when `active` last changed (so the newest device wins)
  // deleted: ids of deleted routines/workouts (so a deletion on one device
  //          isn't undone by the other device's older copy)
  // settings: your choices on the Settings tab (only the ones you've changed);
  //           settingsChangedAt says which device changed them last
  // exerciseNotes: { "bench press": { text, updatedAt } } pinned notes shown every time
  // bodyweights: [{ id, date, lbs, updatedAt }] one entry per day at most
  const empty = () => ({ routines: [], sessions: [], active: null, activeChangedAt: null, deleted: [],
    settings: {}, settingsChangedAt: null, exerciseNotes: {}, bodyweights: [] });

  // What each setting is until you change it.
  const DEFAULT_SETTINGS = {
    restSeconds: 90,          // rest after a working set (0 = no timer)
    warmupRestSeconds: null,  // rest after a warm-up set (null = same as working)
    restAlert: 'both',        // 'sound' | 'vibrate' | 'both'
    keepAwake: true,          // stop the screen locking during a workout
    weightStep: 5,            // what the − / + buttons change the weight by
    barWeight: 45,
    plates: [45, 35, 25, 10, 5, 2.5], // plate sizes you own (pairs)
    autoIncrease: true,       // suggest more weight after hitting every rep
    incUpper: 5,
    incLower: 10,
    weeklyGoal: 4,            // workouts per week (0 = no goal)
    askEffort: true,          // ask "reps left in the tank" after each set
    effortEarly: '2-3',       // aim: reps left on every working set but the last
    effortLast: '0-1',        // aim: reps left on the last working set
    schedule: {},             // { 0: routineId, 2: routineId, ... } 0 = Sunday; empty = rotate in order
    deloadEvery: 6,           // suggest a lighter week after this many training weeks (0 = never)
    deloadPercent: 60,        // working-set weight during a lighter week
    deloadStartedAt: null,    // when the current/last lighter week began
    deloadSnoozedUntil: null, // "Not now" pushes the reminder back a week
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
    } catch {
      return empty();
    }
  }

  let data = load();

  // The rest timer used to be saved only on this device: carry it over once.
  try {
    const oldRest = localStorage.getItem('workout-rest-seconds');
    if (oldRest !== null) {
      if (data.settings.restSeconds === undefined && Number.isFinite(Number(oldRest)) && oldRest !== '') data.settings.restSeconds = Number(oldRest);
      writeLocal();
      localStorage.removeItem('workout-rest-seconds');
    }
  } catch {}
  let onChange = null; // set by sync.js: called after every local change

  function writeLocal() {
    localStorage.setItem(KEY, JSON.stringify(data));
  }
  function save() {
    writeLocal();
    onChange?.();
  }

  const now = () => new Date().toISOString();
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    id,
    get routines() { return data.routines; },
    get sessions() { return data.sessions; },
    save,

    // Used by sync.js.
    getData() { return data; },
    replaceData(next) { data = { ...empty(), ...next }; writeLocal(); },
    set onChange(fn) { onChange = fn; },

    // Body weight log, oldest first.
    get bodyweights() { return [...(data.bodyweights || [])].sort((a, b) => a.date.localeCompare(b.date)); },
    logBodyweight(lbs) {
      const today = new Date().toDateString();
      const list = data.bodyweights || [];
      const existing = list.find(b => new Date(b.date).toDateString() === today);
      if (existing) { existing.lbs = lbs; existing.updatedAt = now(); }
      else list.push({ id: id(), date: now(), lbs, updatedAt: now() });
      data.bodyweights = list;
      save();
    },
    deleteBodyweight(entryId) {
      data.bodyweights = (data.bodyweights || []).filter(b => b.id !== entryId);
      data.deleted.push(entryId);
      save();
    },

    // Renames an exercise everywhere: past workouts, routines, the workout in
    // progress and its pinned note. Renaming to an existing name combines them.
    renameExercise(oldName, newName) {
      const from = oldName.trim().toLowerCase();
      const same = ex => ex.name.trim().toLowerCase() === from;
      const stamp = now();
      for (const s of data.sessions) {
        if (s.exercises.some(same)) { s.exercises.forEach(ex => { if (same(ex)) ex.name = newName; }); s.updatedAt = stamp; }
      }
      for (const r of data.routines) {
        if (r.exercises.some(same)) { r.exercises.forEach(ex => { if (same(ex)) ex.name = newName; }); r.updatedAt = stamp; }
      }
      if (data.active?.exercises.some(same)) {
        data.active.exercises.forEach(ex => { if (same(ex)) ex.name = newName; });
        data.activeChangedAt = stamp;
      }
      const to = newName.trim().toLowerCase();
      const note = data.exerciseNotes?.[from];
      if (note && to !== from) {
        if (!data.exerciseNotes[to]?.text) data.exerciseNotes[to] = { ...note, updatedAt: stamp };
        data.exerciseNotes[from] = { text: '', updatedAt: stamp };
      }
      save();
    },

    // Pinned notes for an exercise (by name), e.g. "elbows tucked".
    exerciseNote(name) { return data.exerciseNotes?.[name.trim().toLowerCase()]?.text || ''; },
    setExerciseNote(name, text) {
      data.exerciseNotes = { ...data.exerciseNotes, [name.trim().toLowerCase()]: { text: text.trim(), updatedAt: now() } };
      save();
    },

    get settings() {
      // Ignore blank values so a damaged setting falls back to its default.
      const mine = Object.fromEntries(Object.entries(data.settings || {})
        .filter(([k, v]) => v !== null || k === 'warmupRestSeconds'));
      return { ...DEFAULT_SETTINGS, ...mine };
    },
    setSetting(key, value) {
      data.settings = { ...data.settings, [key]: value };
      data.settingsChangedAt = now();
      save();
    },

    getRoutine(routineId) {
      return data.routines.find(r => r.id === routineId);
    },
    // Adds a new routine, or replaces the existing one with the same id.
    saveRoutine(routine) {
      routine.updatedAt = now();
      const i = data.routines.findIndex(r => r.id === routine.id);
      if (i >= 0) data.routines[i] = routine;
      else data.routines.push(routine);
      save();
    },
    deleteRoutine(routineId) {
      data.routines = data.routines.filter(r => r.id !== routineId);
      data.deleted.push(routineId);
      save();
    },

    // The workout in progress. Saved on every change so nothing is lost
    // if the phone locks or the page reloads mid-workout.
    get active() { return data.active || null; },
    setActive(session) {
      data.active = session;
      data.activeChangedAt = now();
      save();
    },
    // Moves the workout into history, keeping only sets that were ticked off.
    finishActive() {
      const s = data.active;
      s.finishedAt = now();
      s.exercises = s.exercises
        .filter(ex => !ex.skipped)
        .map(({ last, bump, progressNote, deload, showTools, skipped, ...ex }) => ({ ...ex, sets: ex.sets.filter(set => set.done) }))
        .filter(ex => ex.sets.length);
      data.sessions.push(s);
      data.active = null;
      data.activeChangedAt = now();
      save();
      return s;
    },

    deleteSession(sessionId) {
      data.sessions = data.sessions.filter(s => s.id !== sessionId);
      data.deleted.push(sessionId);
      save();
    },

    // The most recent time this exercise was done (matched by id, then by name).
    lastPerformance(exercise) {
      const name = exercise.name.trim().toLowerCase();
      for (let i = data.sessions.length - 1; i >= 0; i--) {
        const s = data.sessions[i];
        const ex = s.exercises.find(e => e.id === exercise.id) ||
                   s.exercises.find(e => e.name.trim().toLowerCase() === name);
        if (ex) return { date: s.startedAt, sets: ex.sets };
      }
      return null;
    },
  };
})();
