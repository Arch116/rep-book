// Store: the one place that saves and loads data.
// For now it saves in this browser (localStorage). In a later step we swap the
// inside of this file for Supabase so the phone and laptop share the same data;
// the rest of the app won't need to change.

const Store = (() => {
  const KEY = 'workout-app-v1';

  // Shape of everything we save:
  // routines: [{ id, name, exercises: [{ id, name, type, sets: [{ warmup, reps, weight, seconds }] }] }]
  //   type is 'weight' | 'bodyweight' | 'time'
  // sessions: [{ id, routineId, routineName, startedAt, finishedAt, notes,
  //              exercises: [{ id, name, type, note, sets: [{ warmup, target, reps, weight, seconds, done }] }] }]
  // active: the workout in progress (same shape as a session), or null
  const empty = () => ({ routines: [], sessions: [], active: null });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
    } catch {
      return empty();
    }
  }

  let data = load();

  function save() {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    id,
    get routines() { return data.routines; },
    get sessions() { return data.sessions; },
    save,

    getRoutine(routineId) {
      return data.routines.find(r => r.id === routineId);
    },
    // Adds a new routine, or replaces the existing one with the same id.
    saveRoutine(routine) {
      const i = data.routines.findIndex(r => r.id === routine.id);
      if (i >= 0) data.routines[i] = routine;
      else data.routines.push(routine);
      save();
    },
    deleteRoutine(routineId) {
      data.routines = data.routines.filter(r => r.id !== routineId);
      save();
    },

    // The workout in progress. Saved on every change so nothing is lost
    // if the phone locks or the page reloads mid-workout.
    get active() { return data.active || null; },
    setActive(session) {
      data.active = session;
      save();
    },
    // Moves the workout into history, keeping only sets that were ticked off.
    finishActive() {
      const s = data.active;
      s.finishedAt = new Date().toISOString();
      s.exercises = s.exercises
        .map(({ last, ...ex }) => ({ ...ex, sets: ex.sets.filter(set => set.done) }))
        .filter(ex => ex.sets.length);
      data.sessions.push(s);
      data.active = null;
      save();
      return s;
    },

    deleteSession(sessionId) {
      data.sessions = data.sessions.filter(s => s.id !== sessionId);
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
