// Backup: download all your data as a file, and load it back in later.
// Shown at the bottom of the Account screen.

function backupSectionHTML() {
  const r = Store.routines.length, s = Store.sessions.length;
  return `
    <h2 class="section-label">Backup</h2>
    <div class="card">
      <p class="no-top muted small">Download a file with your ${r} routine${r === 1 ? '' : 's'} and ${s} workout${s === 1 ? '' : 's'}.
        Keep it somewhere safe (like iCloud Drive or email) in case you ever need it.</p>
      <div class="editor-actions">
        <button class="btn secondary block" data-b-action="export">Download backup</button>
        <button class="btn secondary block" data-b-action="import">Restore from a backup…</button>
      </div>
      <input type="file" id="backup-file" accept=".json,application/json" hidden>
    </div>`;
}

function downloadBackup() {
  const file = { app: 'workout-log', version: 1, exportedAt: new Date().toISOString(), data: Store.getData() };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  link.download = `workout-backup-${day}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Adds what's in the backup to what's already here. Nothing gets removed.
function restoreBackup(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return alert("That file isn't a workout backup."); }
  const data = parsed?.data ?? parsed;
  if (!Array.isArray(data?.routines) || !Array.isArray(data?.sessions)) {
    return alert("That file isn't a workout backup.");
  }

  const local = Store.getData();
  // (restoredFrom marks a copy brought back by an earlier restore.)
  const have = new Set([...local.routines, ...local.sessions].flatMap(x => [x.id, x.restoredFrom]));
  const newRoutines = data.routines.filter(x => !have.has(x.id)).length;
  const newSessions = data.sessions.filter(x => !have.has(x.id)).length;
  if (!newRoutines && !newSessions) return alert('Everything in that backup is already here.');
  if (!confirm(`Add ${newRoutines} routine${newRoutines === 1 ? '' : 's'} and ${newSessions} workout${newSessions === 1 ? '' : 's'} from the backup? Nothing already here will be removed.`)) return;

  // Things you deleted since the backup would stay deleted (that's how sync
  // keeps deletions from coming back), so they come back as fresh copies.
  const gone = new Set(local.deleted || []);
  const newIds = new Map(local.routines.filter(r => r.restoredFrom).map(r => [r.restoredFrom, r.id]));
  const revive = x => {
    if (!gone.has(x.id)) return structuredClone(x);
    newIds.set(x.id, Store.id());
    return { ...structuredClone(x), id: newIds.get(x.id), restoredFrom: x.id };
  };
  const routines = data.routines.filter(x => !have.has(x.id)).map(revive);
  const sessions = data.sessions.filter(x => !have.has(x.id)).map(revive).map(s =>
    newIds.has(s.routineId) ? { ...s, routineId: newIds.get(s.routineId) } : s);

  Store.replaceData(Sync.merge(local, { routines, sessions }));
  Store.save(); // also syncs to your other devices
  accountMessage = 'Backup restored.';
  renderAccount();
  updateWorkoutDot();
}

viewEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-b-action]');
  if (!btn) return;
  if (btn.dataset.bAction === 'export') downloadBackup();
  else viewEl.querySelector('#backup-file').click();
});

viewEl.addEventListener('change', async e => {
  if (e.target.id !== 'backup-file') return;
  const file = e.target.files[0];
  e.target.value = '';
  if (file) restoreBackup(await file.text());
});
