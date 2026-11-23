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
  const empty = () => ({ routines: [], sessions: [], active: null, activeChangedAt: null, deleted: [],
    settings: {}, settingsChangedAt: null });

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
      if (data.settings.restSeconds === undefined) data.settings.restSeconds = Number(oldRest);
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

    get settings() { return { ...DEFAULT_SETTINGS, ...data.settings }; },
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
        .map(({ last, bump, ...ex }) => ({ ...ex, sets: ex.sets.filter(set => set.done) }))
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
