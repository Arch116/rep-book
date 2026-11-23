// Sync: keeps this device and your Supabase copy in step.
//
// How it works, in plain terms:
// - The app always saves on this device first, so it works with no signal.
// - A few seconds after any change, and whenever you open the app, it fetches
//   the online copy, combines it with this device's copy, and uploads the result.
// - Combining never loses a logged workout: workouts from both devices are kept,
//   the most recently edited version of each routine wins, and anything you
//   deleted stays deleted.

const Sync = (() => {
  const cfg = window.APP_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseKey);
  const client = configured && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey)
    : null;

  let user = null;
  // 'off' (not set up) | 'unavailable' (couldn't load) | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error'
  let status = !configured ? 'off' : client ? 'signed-out' : 'unavailable';
  let lastSynced = Number(safeGet('workout-last-synced')) || null;
  let timer = null;
  let running = false;
  let runAgain = false;
  const listeners = new Set();

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

  function setStatus(s) {
    status = s;
    listeners.forEach(fn => fn());
  }

  // Same data → same text, whatever order the keys come back in.
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().filter(k => value[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
  }

  function merge(a, b) {
    const deleted = [...new Set([...(a.deleted || []), ...(b.deleted || [])])];
    const gone = new Set(deleted);
    const combine = (xs = [], ys = [], pick) => {
      const m = new Map();
      for (const x of xs) m.set(x.id, x);
      for (const y of ys) m.set(y.id, m.has(y.id) ? pick(m.get(y.id), y) : y);
      return [...m.values()].filter(x => !gone.has(x.id));
    };
    const newer = (x, y) => ((y.updatedAt || '') > (x.updatedAt || '') ? y : x);

    const routines = combine(a.routines, b.routines, newer);
    const sessions = combine(a.sessions, b.sessions, newer) // newer wins (e.g. after a rename)
      .sort((x, y) => x.startedAt.localeCompare(y.startedAt));

    const useB = (b.activeChangedAt || '') > (a.activeChangedAt || '');
    let active = useB ? b.active : a.active;
    const activeChangedAt = (useB ? b.activeChangedAt : a.activeChangedAt) || null;
    if (active && (gone.has(active.id) || sessions.some(s => s.id === active.id))) active = null;

    // Settings: whichever device changed them most recently wins.
    const settingsFromB = (b.settingsChangedAt || '') > (a.settingsChangedAt || '');
    const settings = (settingsFromB ? b.settings : a.settings) || {};
    const settingsChangedAt = (settingsFromB ? b.settingsChangedAt : a.settingsChangedAt) || null;

    // Pinned exercise notes: newest edit of each note wins.
    const exerciseNotes = { ...(a.exerciseNotes || {}) };
    for (const [k, v] of Object.entries(b.exerciseNotes || {})) {
      if (!exerciseNotes[k] || (v.updatedAt || '') > (exerciseNotes[k].updatedAt || '')) exerciseNotes[k] = v;
    }

    return { routines, sessions, deleted, active: active || null, activeChangedAt, settings, settingsChangedAt, exerciseNotes };
  }

  async function syncNow() {
    if (!client || !user) return;
    if (running) { runAgain = true; return; }
    running = true;
    clearTimeout(timer);
    setStatus('syncing');
    try {
      const { data: row, error } = await client
        .from('app_data').select('data').eq('user_id', user.id).maybeSingle();
      if (error) throw error;

      const local = Store.getData();
      const merged = row ? merge(local, row.data || {}) : local;

      if (stable(merged) !== stable(local)) {
        Store.replaceData(merged);
        window.onSyncedData?.(); // redraw the screen with the combined data
      }
      if (!row || stable(merged) !== stable(row.data)) {
        const { error: upErr } = await client.from('app_data').upsert({
          user_id: user.id,
          data: merged,
          updated_at: new Date().toISOString(),
        });
        if (upErr) throw upErr;
      }
      lastSynced = Date.now();
      safeSet('workout-last-synced', String(lastSynced));
      setStatus('synced');
    } catch (err) {
      console.warn('Sync failed:', err);
      setStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      running = false;
      if (runAgain) { runAgain = false; syncNow(); }
    }
  }

  // Wait a moment after changes so typing doesn't upload on every keystroke.
  function scheduleSync() {
    if (!client || !user) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 2000);
  }

  async function init() {
    if (!client) { setStatus(status); return; }
    Store.onChange = scheduleSync;

    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    setStatus(user ? 'synced' : 'signed-out');
    if (user) syncNow();

    client.auth.onAuthStateChange((_event, session) => {
      const before = user?.id;
      user = session?.user || null;
      if (!user) setStatus('signed-out');
      else if (user.id !== before) setTimeout(syncNow, 0);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow();
    });
    window.addEventListener('online', syncNow);
  }

  return {
    init,
    syncNow,
    merge, // exposed for testing
    get status() { return status; },
    get user() { return user; },
    get lastSynced() { return lastSynced; },
    onStatus(fn) { listeners.add(fn); },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error ? error.message : null;
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) return { error: error.message };
      return { needsConfirm: !data.session };
    },
    async signOut() {
      await syncNow();
      await client.auth.signOut();
    },
  };
})();
