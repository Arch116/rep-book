// Settings tab (#/settings): sign in and sync, rest timer, backup.
// Also draws the small sync indicator in the top-right corner.

const syncBadge = document.getElementById('sync-badge');

function timeAgo(ms) {
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_TEXT = {
  'off': 'Sync not set up',
  'unavailable': 'Sync unavailable',
  'signed-out': 'Sign in to sync',
  'syncing': 'Syncing…',
  'synced': 'Synced',
  'offline': 'Offline',
  'error': 'Sync problem',
};

function updateSyncBadge() {
  const s = Sync.status;
  syncBadge.hidden = s === 'off';
  syncBadge.className = `sync-badge ${s}`;
  syncBadge.querySelector('span').textContent = STATUS_TEXT[s];
}

let accountMessage = '';

function renderSettings() {
  drawAccount();
  viewEl.insertAdjacentHTML('afterbegin', '<h2 class="section-label">Sync</h2>');
  viewEl.insertAdjacentHTML('beforeend',
    workoutSettingsHTML() + weightSettingsHTML() + goalSettingsHTML() + planSettingsHTML() + displaySettingsHTML() +
    backupSectionHTML() + aboutHTML());
}
const renderAccount = renderSettings; // the sign-in code below redraws with this name

/* ---------- Settings controls ---------- */
// A row of choices; tapping one saves it. `local` = this device only.
function choices(key, options, current, label) {
  return `
    <div class="setting">
      <div class="setting-label">${label}</div>
      <div class="seg" role="group" aria-label="${esc(label)}">
        ${options.map(([value, text]) => `
          <button data-setting="${key}" data-value='${JSON.stringify(value)}' class="${value === current ? 'on' : ''}" aria-pressed="${value === current}">${text}</button>`).join('')}
      </div>
    </div>`;
}
function onOff(key, current, label, hint) {
  return `
    <button class="toggle-row setting" data-setting="${key}" data-value='${JSON.stringify(!current)}' aria-pressed="${current}">
      <span class="toggle ${current ? 'on' : ''}" aria-hidden="true"></span>
      <span>${label}${hint ? `<span class="muted small block-hint">${hint}</span>` : ''}</span>
    </button>`;
}
const time = v => (v ? mmss(v) : 'Off');

function workoutSettingsHTML() {
  const st = Store.settings;
  return `
    <h2 class="section-label">Workout</h2>
    <div class="card">
      ${choices('restSeconds', [0, 60, 90, 120, 180].map(v => [v, time(v)]), st.restSeconds, 'Rest after working sets')}
      ${choices('warmupRestSeconds', [[null, 'Same'], [30, '0:30'], [45, '0:45'], [60, '1:00'], [90, '1:30']], st.warmupRestSeconds, 'Rest after warm-up sets')}
      ${choices('restAlert', [['sound', 'Sound'], ['vibrate', 'Vibrate'], ['both', 'Both']], st.restAlert, 'When rest is over')}
      <p class="muted small setting-note">iPhones can't vibrate for web apps, and the sound follows your ringer switch. Alerts only play while Rep Book is open.</p>
      ${onOff('keepAwake', st.keepAwake, 'Keep the screen on during a workout')}
      ${onOff('askEffort', st.askEffort, 'Effort targets (reps left in the tank)', 'After each working set, tap how many more reps you could have done. Weight goes up only when your first sets stay within your aim.')}
      ${st.askEffort ? `
        ${choices('effortEarly', [['1-2', '1–2'], ['2-3', '2–3'], ['3-4', '3–4']], st.effortEarly, 'Aim for these reps left on your first sets')}
        ${choices('effortLast', [['0-1', '0–1'], ['1-2', '1–2'], ['2-3', '2–3']], st.effortLast, 'And on your last set')}` : ''}
    </div>`;
}

const PLATE_SIZES = [55, 45, 35, 25, 15, 10, 5, 2.5, 1.25];
function weightSettingsHTML() {
  const st = Store.settings;
  return `
    <h2 class="section-label">Weights</h2>
    <div class="card">
      ${choices('weightStep', [[2.5, '2.5'], [5, '5'], [10, '10']], st.weightStep, 'The − / + buttons change weight by (lbs)')}
      ${choices('barWeight', [[45, '45'], [35, '35'], [25, '25'], [15, '15']], st.barWeight, 'Bar weight (lbs)')}
      ${choices('maxDumbbell', [[0, 'None'], [25, '25'], [50, '50'], [75, '75'], [100, '100']], st.maxDumbbell, 'Heaviest dumbbell you own (lbs)')}
      <div class="setting">
        <div class="setting-label">Plates you own (lbs)</div>
        <div class="chip-grid">
          ${PLATE_SIZES.map(p => `
            <button class="plate-chip ${st.plates.includes(p) ? 'on' : ''}" data-plate="${p}" aria-pressed="${st.plates.includes(p)}">${p}</button>`).join('')}
        </div>
      </div>
      ${onOff('autoIncrease', st.autoIncrease, 'Suggest more weight', 'When you hit every target rep, the next workout starts heavier.')}
      ${st.autoIncrease ? `
        ${choices('incUpper', [[2.5, '+2.5'], [5, '+5'], [10, '+10']], st.incUpper, 'Upper-body lifts')}
        ${choices('incLower', [[5, '+5'], [10, '+10'], [15, '+15'], [20, '+20']], st.incLower, 'Leg and hip lifts (squats, deadlifts…)')}` : ''}
    </div>`;
}

function goalSettingsHTML() {
  const st = Store.settings;
  return `
    <h2 class="section-label">Goal</h2>
    <div class="card">
      ${choices('weeklyGoal', [[0, 'None'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], st.weeklyGoal, 'Workouts per week (weeks start Sunday)')}
    </div>`;
}

function planSettingsHTML() {
  const st = Store.settings;
  const sched = st.schedule || {};
  const routines = Store.routines;
  const rows = DAY_NAMES.map((day, i) => `
    <label class="sched-row">
      <span>${day}</span>
      <select data-schedule-day="${i}" aria-label="Routine on ${day}">
        <option value="">Rest</option>
        ${routines.map(r => `<option value="${r.id}" ${sched[i] === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
      </select>
    </label>`).join('');
  return `
    <h2 class="section-label">Weekly schedule</h2>
    <div class="card">
      <p class="no-top muted small">Pick a routine for each training day. Home then shows what's planned. Leave every day on Rest to simply rotate through your routines in order.</p>
      ${routines.length ? rows : '<p class="muted small">Create a routine first.</p>'}
    </div>
    <h2 class="section-label">Lighter weeks</h2>
    <div class="card">
      ${choices('deloadEvery', [[0, 'Never'], [4, '4 wks'], [6, '6 wks'], [8, '8 wks']], st.deloadEvery, 'Suggest a lighter week after')}
      ${st.deloadEvery ? choices('deloadPercent', [[50, '50%'], [60, '60%'], [70, '70%']], st.deloadPercent, 'Weight during a lighter week') : ''}
    </div>`;
}

viewEl.addEventListener('change', e => {
  const sel = e.target.closest('[data-schedule-day]');
  if (!sel) return;
  Store.setSetting('schedule', { ...Store.settings.schedule, [sel.dataset.scheduleDay]: sel.value || null });
});

function displaySettingsHTML() {
  return `
    <h2 class="section-label">Display</h2>
    <div class="card">
      ${choices('textSize', Object.entries(TEXT_SIZES).map(([v, t]) => [Number(v), t]), textSize(), 'Text size (this device only)')}
    </div>`;
}

function aboutHTML() {
  return `<p class="muted small about">Rep Book · weights in pounds<br>Settings sync between your devices, except text size.</p>`;
}

viewEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-setting], [data-plate]');
  if (!btn) return;
  if (btn.dataset.plate) {
    const p = Number(btn.dataset.plate);
    const plates = Store.settings.plates;
    Store.setSetting('plates', plates.includes(p) ? plates.filter(x => x !== p) : [...plates, p]);
  } else {
    const key = btn.dataset.setting;
    const value = JSON.parse(btn.dataset.value);
    if (key === 'textSize') applyTextSize(value);
    else Store.setSetting(key, value);
    if (key === 'restSeconds' && !value) { restEndsAt = null; saveRestEnd(); }
  }
  renderSettings();
});

function drawAccount() {
  const s = Sync.status;
  const msg = accountMessage ? `<div class="toast">${esc(accountMessage)}</div>` : '';
  accountMessage = '';

  if (s === 'off') {
    viewEl.innerHTML = `
      <div class="card">
        <p class="no-top">Sync isn't set up yet, so your data is saved on this device only.</p>
      </div>`;
    return;
  }
  if (s === 'unavailable') {
    viewEl.innerHTML = `
      <div class="card"><p class="no-top">Couldn't load the sync service. Check your internet connection and reload. Your data is still saved on this device.</p></div>`;
    return;
  }

  if (!Sync.user) {
    viewEl.innerHTML = `${msg}
      <p class="muted hint">Sign in to keep your phone and laptop in step. Without signing in, everything is saved on this device only.</p>
      <form id="auth-form" class="card" novalidate>
        <label class="field"><span>Email</span>
          <input type="email" name="email" autocomplete="username" inputmode="email" required></label>
        <label class="field"><span>Password</span>
          <input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
        <p class="error-text" id="auth-error" hidden></p>
        <div class="editor-actions">
          <button class="btn block" type="submit" name="mode" value="signin">Sign in</button>
          <button class="btn secondary block" type="submit" name="mode" value="signup">Create account</button>
        </div>
      </form>`;
    return;
  }

  const last = Sync.lastSynced ? timeAgo(Sync.lastSynced) : 'not yet';
  viewEl.innerHTML = `${msg}
    <div class="card">
      <div class="muted small">Signed in as</div>
      <div class="routine-name">${esc(Sync.user.email)}</div>
      <div class="muted small">${STATUS_TEXT[s]} · last synced ${last}</div>
    </div>
    <div class="editor-actions">
      <button class="btn secondary block" data-a-action="sync">Sync now</button>
      <button class="btn danger block" data-a-action="signout">Sign out</button>
    </div>
    <p class="muted small hint">Signing out keeps a copy of your data on this device.</p>`;
}

viewEl.addEventListener('submit', async e => {
  if (e.target.id !== 'auth-form') return;
  e.preventDefault();
  const form = e.target;
  const mode = e.submitter?.value || 'signin';
  const email = form.email.value.trim();
  const password = form.password.value;
  const errEl = form.querySelector('#auth-error');
  const showError = text => { errEl.textContent = text; errEl.hidden = false; };

  if (!email || !password) return showError('Enter your email and a password.');
  if (password.length < 6) return showError('Passwords need at least 6 characters.');

  form.querySelectorAll('button').forEach(b => { b.disabled = true; });
  if (mode === 'signup') {
    const result = await Sync.signUp(email, password);
    if (result.error) {
      form.querySelectorAll('button').forEach(b => { b.disabled = false; });
      return showError(result.error);
    }
    accountMessage = result.needsConfirm
      ? 'Account created. Check your email and tap the confirmation link, then come back and sign in.'
      : 'Account created and signed in.';
  } else {
    const error = await Sync.signIn(email, password);
    if (error) {
      form.querySelectorAll('button').forEach(b => { b.disabled = false; });
      return showError(error === 'Email not confirmed'
        ? 'Please tap the confirmation link in your email first.'
        : error);
    }
    accountMessage = 'Signed in. Your data will now sync.';
  }
  renderAccount();
});

viewEl.addEventListener('click', async e => {
  const btn = e.target.closest('[data-a-action]');
  if (!btn) return;
  if (btn.dataset.aAction === 'sync') {
    await Sync.syncNow();
    if (Sync.status === 'synced') accountMessage = 'All synced.';
    renderAccount();
  } else if (btn.dataset.aAction === 'signout') {
    if (!confirm('Sign out? Your data stays on this device but stops syncing.')) return;
    await Sync.signOut();
    renderAccount();
  }
});

Sync.onStatus(() => {
  updateSyncBadge();
  // Refresh the account screen if it's open (but not while typing in the form).
  const onSettings = /^#\/(settings|account)/.test(location.hash);
  // Redraw, except while you're filling in the sign-in form (unless you're now signed in).
  if (onSettings && (Sync.user || !viewEl.querySelector('#auth-form'))) renderSettings();
});
updateSyncBadge();
