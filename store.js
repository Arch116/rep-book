// Store: the one place that saves and loads data.
// For now it saves in this browser (localStorage). In a later step we swap the
// inside of this file for Supabase so the phone and laptop share the same data;
// the rest of the app won't need to change.

const Store = (() => {
  const KEY = 'workout-app-v1';

  // Shape of everything we save:
  // routines: [{ id, name, exercises: [{ id, name, type, sets: [{ warmup, reps, weight, seconds }] }] }]
  //   type is 'weight' | 'bodyweight' | 'time'
  // sessions: [{ id, routineId, routineName, startedAt, finishedAt, notes, exercises: [...] }]
  const empty = () => ({ routines: [], sessions: [] });

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
  };
})();
