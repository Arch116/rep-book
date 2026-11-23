// Progress: pick an exercise, see how it has changed over time.
// Weight and reps are different kinds of numbers, so they get two separate
// charts stacked on the same dates (one scale per chart is easier to read).

let progressCharts = [];

const exerciseKey = name => name.trim().toLowerCase();

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
      <div class="stat"><div class="stat-label">Latest</div><div class="stat-value">${fmtTop(latest)}</div><div class="muted small">${shortDate(latest.date)}</div></div>
      <div class="stat"><div class="stat-label">Workouts</div><div class="stat-value">${pts.length}</div><div class="muted small">since ${shortDate(pts[0].date)}</div></div>
    </div>`;
}

function renderProgress(selectedKey) {
  progressCharts.forEach(c => c.destroy());
  progressCharts = [];

  const histories = exerciseHistories();
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
        ${histories.map(x => `<option value="${esc(x.key)}" ${x.key === h.key ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      </select>
    </label>
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

  viewEl.querySelector('#exercise-pick').addEventListener('change', e => {
    location.hash = `#/history/progress/${encodeURIComponent(e.target.value)}`;
  });

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
