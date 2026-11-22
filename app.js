// App: decides which screen to show based on the address (#/routines, etc.)
// and draws it into the <main id="view"> area.

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('page-title');

const screens = {
  routines: {
    title: 'Routines',
    render() {
      return `
        <div class="empty">
          <p>No routines yet.<br>Create one like Push, Pull, Deadlift or Squat.</p>
          <button class="btn" disabled>New routine (coming in step 2)</button>
        </div>`;
    },
  },
  workout: {
    title: 'Workout',
    render() {
      return `
        <div class="empty">
          <p>Start a workout from one of your routines.<br>(Coming in step 3)</p>
        </div>`;
    },
  },
  history: {
    title: 'History',
    render() {
      return `
        <div class="empty">
          <p>Your finished workouts and progress charts will show here.<br>(Coming in steps 4 and 5)</p>
        </div>`;
    },
  },
};

function route() {
  const name = location.hash.replace('#/', '').split('/')[0] || 'routines';
  const screen = screens[name] || screens.routines;
  titleEl.textContent = screen.title;
  viewEl.innerHTML = screen.render();
  document.querySelectorAll('.tabbar a').forEach(a =>
    a.classList.toggle('active', a.dataset.tab === name));
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
