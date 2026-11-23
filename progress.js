// Progress: pick an exercise, see how it has changed over time.
// Weight and reps are different kinds of numbers, so they get two separate
// charts stacked on the same dates (one scale per chart is easier to read).

let progressCharts = [];

const exerciseKey = name => name.trim().toLowerCase();
const BODYWEIGHT_KEY = '__bodyweight';

// Estimated one-rep max from a set (Epley formula): 5 × 225 ≈ 263.
// Only trusted up to about 12 reps.
const e1rm = (weight, reps) => (!weight || !reps || reps > 12 ? 0 : reps === 1 ? weight : Math.round(weight * (1 + reps / 30)));

// Every exercise you've logged, with one data point per workout.
function exerciseHistories() {
  const map = new Map();
  const sessions = [...Store.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const s of sessions) {
    for (const ex of s.exercises) {
      const key = exerciseKey(ex.name);
      if (!map.has(key)) map.set(key, { key, name: ex.name, type: ex.type, points: [] });
      const h = map.get(key);
      h.name = ex.name; // keep the most recent spelling
      h.type = ex.type;
      const working = ex.sets.filter(x => !x.warmup);
      const pool = working.length ? working : ex.sets;
      h.points.push({
        sessionId: s.id,
        date: s.startedAt,
        top: bestSet(ex),
        maxReps: Math.max(...pool.map(x => x.reps || 0)),
        maxAdded: Math.max(...pool.map(x => x.weight || 0)),
        e1rm: Math.max(0, ...pool.map(x => e1rm(x.weight, x.reps))),
        sets: working,
      });
    }
  }
  // Most recently done first in the picker.
  return [...map.values()].sort((a, b) =>
    b.points[b.points.length - 1].date.localeCompare(a.points[a.points.length - 1].date));
}

function historySwitch(active) {
  return `
    <div class="seg page-seg">
      <a href="#/history" class="${active === 'workouts' ? 'on' : ''}">Workouts</a>
      <a href="#/history/progress" class="${active === 'progress' ? 'on' : ''}">Progress</a>
      <a href="#/history/records" class="${active === 'records' ? 'on' : ''}">Records</a>
    </div>`;
}

// Which numbers to chart for each kind of exercise.
function seriesFor(h) {
  const pts = h.points;
  if (h.type === 'time') {
    return [{ label: 'Longest hold', unit: 'sec', values: pts.map(p => p.top.seconds || 0) }];
  }
  if (h.type === 'bodyweight') {
    const list = [{ label: 'Most reps in a set', unit: 'reps', values: pts.map(p => p.maxReps) }];
    if (pts.some(p => p.maxAdded > 0)) {
      list.push({ label: 'Most added weight', unit: 'lbs', values: pts.map(p => p.maxAdded) });
    }
    return list;
  }
  return [
    ...(pts.some(p => p.e1rm) ? [{ label: 'Estimated 1-rep max', unit: 'lbs', values: pts.map(p => p.e1rm || null) }] : []),
    { label: 'Top set weight', unit: 'lbs', values: pts.map(p => p.top.weight || 0) },
    { label: 'Reps on top set', unit: 'reps', values: pts.map(p => p.top.reps || 0) },
  ];
}

// How good one workout's result for an exercise was (higher = better).
function pointScore(h, p) {
  return h.type === 'time' ? (p.top.seconds || 0)
    : h.type === 'bodyweight' ? p.maxAdded * 1000 + p.maxReps
    : (p.top.weight || 0) * 1000 + (p.top.reps || 0);
}
// e.g. "8 × 155", "12 reps / +25", "60s"
function pointText(h, p) {
  return h.type === 'bodyweight'
    ? `${p.maxReps} reps${p.maxAdded ? ` / +${p.maxAdded}` : ''}`
    : fmtSet(h.type, p.top);
}

function statTiles(h) {
  const pts = h.points;
  const latest = pts[pts.length - 1];
  const best = pts.reduce((b, p) => (pointScore(h, p) > pointScore(h, b) ? p : b), pts[0]);
  const fmtTop = p => pointText(h, p);
  return `
    <div class="stats">
      <div class="stat"><div class="stat-label">Best</div><div class="stat-value">${fmtTop(best)}</div><div class="muted small">${shortDate(best.date)}</div></div>
      ${h.type === 'weight' && pts.some(p => p.e1rm) ? (() => {
        const top = pts.reduce((b, p) => (p.e1rm > b.e1rm ? p : b), pts[0]);
        return `<div class="stat"><div class="stat-label">Est. 1RM</div><div class="stat-value">${top.e1rm}</div><div class="muted small">${shortDate(top.date)}</div></div>`;
      })() : `<div class="stat"><div class="stat-label">Latest</div><div class="stat-value">${fmtTop(latest)}</div><div class="muted small">${shortDate(latest.date)}</div></div>`}
      <div class="stat"><div class="stat-label">Workouts</div><div class="stat-value">${pts.length}</div><div class="muted small">since ${shortDate(pts[0].date)}</div></div>
    </div>`;
}

function renderProgress(selectedKey) {
  progressCharts.forEach(c => c.destroy());
  progressCharts = [];

  const histories = exerciseHistories();
  const hasBodyweight = Store.bodyweights.length > 0;
  if (selectedKey === BODYWEIGHT_KEY || (!histories.length && hasBodyweight)) return renderBodyweight(histories);
  if (!histories.length) {
    viewEl.innerHTML = `${historySwitch('progress')}
      <div class="empty"><p>No workouts yet.<br>Your progress charts appear after your first finished workout.</p></div>`;
    return;
  }

  const key = selectedKey ? decodeURIComponent(selectedKey) : histories[0].key;
  const h = histories.find(x => x.key === key) || histories[0];
  const series = seriesFor(h);
  const chartsAvailable = typeof window.Chart !== 'undefined';

  viewEl.innerHTML = `
    ${historySwitch('progress')}
    <label class="field">
      <span>Exercise</span>
      <select id="exercise-pick">
        ${exerciseOptions(histories, h.key)}
      </select>
    </label>
    <button class="link-btn rename-link" data-p-action="rename" data-name="${esc(h.name)}">Rename this exercise</button>
    ${statTiles(h)}
    ${h.points.length < 2 ? '<p class="muted small hint">Log this exercise a few more times to see a trend.</p>' : ''}
    ${series.map((s, i) => `
      <div class="card chart-card">
        <div class="chart-title">${s.label} <span class="muted small">(${s.unit})</span></div>
        ${chartsAvailable
          ? `<div class="chart-box"><canvas id="chart-${i}" role="img" aria-label="${s.label} over time for ${esc(h.name)}"></canvas></div>`
          : '<p class="muted small">Charts need an internet connection to load. Your numbers are listed below.</p>'}
      </div>`).join('')}
    <h2 class="section-label">Every workout</h2>
    ${[...h.points].reverse().map(p => `
      <a class="card progress-row" href="#/history/${p.sessionId}">
        <span class="muted small">${shortDate(p.date)}</span>
        <span>${p.sets.map(x => fmtSet(h.type, x)).join(', ') || '—'}</span>
      </a>`).join('')}`;

  watchExercisePicker();

  if (chartsAvailable) {
    const labels = h.points.map(p => shortDate(p.date));
    series.forEach((s, i) => {
      progressCharts.push(makeLineChart(viewEl.querySelector(`#chart-${i}`), labels, s));
    });
  }
}

function makeLineChart(canvas, labels, s) {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim();
  const muted = css.getPropertyValue('--muted').trim();
  const grid = css.getPropertyValue('--border').trim();
  const surface = css.getPropertyValue('--surface').trim();
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: s.label,
        data: s.values,
        borderColor: accent,
        backgroundColor: accent,
        borderWidth: 2,
        pointRadius: 4,          // 8px dots
        pointHoverRadius: 6,
        pointBorderColor: surface, // thin ring so dots stand off the line
        pointBorderWidth: 2,
        tension: 0,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false }, // tap anywhere near a date
      plugins: {
        legend: { display: false }, // one line per chart; the title names it
        tooltip: {
          displayColors: false,
          callbacks: { label: ctx => `${ctx.parsed.y} ${s.unit}` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
          border: { color: grid },
        },
        y: {
          grace: '10%',
          ticks: { color: muted, maxTicksLimit: 5, precision: 0 },
          grid: { color: grid },
          border: { display: false },
        },
      },
    },
  });
}

/* ---------- Shared bits for the Progress screens ---------- */

function exerciseOptions(histories, selected) {
  return `<option value="${BODYWEIGHT_KEY}" ${selected === BODYWEIGHT_KEY ? 'selected' : ''}>Body weight</option>
    ${histories.map(x => `<option value="${esc(x.key)}" ${x.key === selected ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
}
function watchExercisePicker() {
  viewEl.querySelector('#exercise-pick').addEventListener('change', e => {
    location.hash = `#/history/progress/${encodeURIComponent(e.target.value)}`;
  });
}

/* ---------- Body weight ---------- */

function logBodyweightPrompt() {
  const last = Store.bodyweights.at(-1);
  const text = prompt('Your body weight today (lbs):', last ? last.lbs : '');
  if (text === null) return false;
  const lbs = Number(String(text).replace(/[^\d.]/g, ''));
  if (!lbs || lbs < 50 || lbs > 700) { alert('Enter your weight in pounds, like 182.5'); return false; }
  Store.logBodyweight(Math.round(lbs * 10) / 10);
  return true;
}

function renderBodyweight(histories) {
  progressCharts.forEach(c => c.destroy());
  progressCharts = [];
  const list = Store.bodyweights;
  const chartsAvailable = typeof window.Chart !== 'undefined';
  const latest = list.at(-1), first = list[0];
  const change = latest && first && list.length > 1 ? +(latest.lbs - first.lbs).toFixed(1) : null;
  viewEl.innerHTML = `
    ${historySwitch('progress')}
    <label class="field">
      <span>Exercise</span>
      <select id="exercise-pick">${exerciseOptions(histories, BODYWEIGHT_KEY)}</select>
    </label>
    ${latest ? `
      <div class="stats">
        <div class="stat"><div class="stat-label">Latest</div><div class="stat-value">${latest.lbs}</div><div class="muted small">${shortDate(latest.date)}</div></div>
        <div class="stat"><div class="stat-label">Change</div><div class="stat-value">${change === null ? '–' : `${change > 0 ? '+' : ''}${change}`}</div><div class="muted small">${first ? `since ${shortDate(first.date)}` : ''}</div></div>
        <div class="stat"><div class="stat-label">Entries</div><div class="stat-value">${list.length}</div><div class="muted small">logged</div></div>
      </div>` : '<p class="muted hint">No entries yet.</p>'}
    <button class="btn block" data-p-action="log-bw">Log today's weight</button>
    ${list.length > 1 ? `
      <div class="card chart-card">
        <div class="chart-title">Body weight <span class="muted small">(lbs)</span></div>
        ${chartsAvailable ? '<div class="chart-box"><canvas id="chart-bw" role="img" aria-label="Body weight over time"></canvas></div>'
          : '<p class="muted small">Charts need an internet connection to load. Your entries are listed below.</p>'}
      </div>` : ''}
    ${list.length ? '<h2 class="section-label">Entries</h2>' : ''}
    ${[...list].reverse().map(b => `
      <div class="card routine-card">
        <div><div class="routine-name">${b.lbs} lbs</div><div class="muted small">${longDate(b.date)}</div></div>
        <button class="icon-btn" data-p-action="del-bw" data-id="${b.id}" aria-label="Delete entry from ${longDate(b.date)}">×</button>
      </div>`).join('')}`;
  watchExercisePicker();
  if (chartsAvailable && list.length > 1) {
    progressCharts.push(makeLineChart(viewEl.querySelector('#chart-bw'), list.map(b => shortDate(b.date)),
      { label: 'Body weight', unit: 'lbs', values: list.map(b => b.lbs) }));
  }
}

/* ---------- Records ---------- */

function renderRecords() {
  const histories = exerciseHistories().sort((a, b) => a.name.localeCompare(b.name));
  if (!histories.length) {
    viewEl.innerHTML = `${historySwitch('records')}
      <div class="empty"><p>No records yet.<br>Your bests show up here after your first workout.</p></div>`;
    return;
  }
  const best = (pts, f) => pts.reduce((b, p) => (f(p) > f(b) ? p : b), pts[0]);
  const rows = histories.map(h => {
    const pts = h.points;
    let lines;
    if (h.type === 'weight') {
      const heavy = best(pts, p => (p.top.weight || 0) * 1000 + (p.top.reps || 0));
      const est = best(pts, p => p.e1rm || 0);
      lines = [`Heaviest: ${fmtSet('weight', heavy.top)} (${shortDate(heavy.date)})`,
        est.e1rm ? `Est. 1-rep max: ${est.e1rm} lbs (${shortDate(est.date)})` : ''];
    } else if (h.type === 'bodyweight') {
      const reps = best(pts, p => p.maxReps);
      const added = best(pts, p => p.maxAdded);
      lines = [`Most reps: ${reps.maxReps} (${shortDate(reps.date)})`,
        added.maxAdded ? `Most added: +${added.maxAdded} lbs (${shortDate(added.date)})` : ''];
    } else {
      const hold = best(pts, p => p.top.seconds || 0);
      lines = [`Longest: ${hold.top.seconds}s (${shortDate(hold.date)})`];
    }
    return `
      <a class="card routine-card" href="#/history/progress/${encodeURIComponent(h.key)}">
        <div>
          <div class="routine-name">${esc(h.name)}</div>
          ${lines.filter(Boolean).map(l => `<div class="muted small">${l}</div>`).join('')}
        </div>
        <span class="chevron" aria-hidden="true">›</span>
      </a>`;
  }).join('');
  viewEl.innerHTML = historySwitch('records') + rows;
}

viewEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-p-action]');
  if (!btn) return;
  const action = btn.dataset.pAction;
  if (action === 'rename') {
    const oldName = btn.dataset.name;
    const name = prompt(`Rename "${oldName}" everywhere (past workouts, routines and charts) to:`, oldName)?.trim();
    if (!name || name === oldName) return;
    const target = exerciseKey(name);
    const exists = exerciseHistories().some(h => h.key === target && h.key !== exerciseKey(oldName));
    if (exists && !confirm(`You already have "${name}". Combine the two into one history?`)) return;
    Store.renameExercise(oldName, name);
    location.hash = `#/history/progress/${encodeURIComponent(target)}`;
  } else if (action === 'log-bw') {
    if (logBodyweightPrompt()) renderBodyweight(exerciseHistories());
  } else if (action === 'del-bw') {
    if (!confirm('Delete this body weight entry?')) return;
    Store.deleteBodyweight(btn.dataset.id);
    renderBodyweight(exerciseHistories());
  }
});
