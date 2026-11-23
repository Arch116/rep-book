// Account screen (#/account): sign in, sign out, and see sync status.
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

function renderAccount() {
  titleEl.textContent = 'Account';
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
  if (location.hash.startsWith('#/account') && !viewEl.querySelector('#auth-form')) renderAccount();
});
updateSyncBadge();
