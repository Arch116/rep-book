// Offline helper ("service worker"). It keeps a copy of the app's files on
// your device so the app still opens when you have no signal.
//
// - The app's own files: try the internet first (so you always get the newest
//   version), and fall back to the saved copy if that fails or takes too long.
// - Chart.js and the Supabase library: their addresses include a version
//   number and never change, so the saved copy is used straight away.
// - Your data going to and from Supabase is never touched here.

const CACHE = 'workout-app-v1';

const APP_FILES = [
  './', 'index.html', 'styles.css', 'config.js', 'store.js', 'sync.js', 'app.js',
  'workout.js', 'history.js', 'progress.js', 'account.js', 'backup.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const LIBRARIES = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...APP_FILES, ...LIBRARIES])));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (LIBRARIES.includes(url.href)) {
    event.respondWith(caches.match(req).then(hit => hit || fetchAndSave(req)));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  }
  // Anything else (Supabase sign-in and data) goes straight to the internet.
});

async function fetchAndSave(req) {
  // 'no-cache' = always ask the server whether there's a newer version.
  const res = await fetch(req, { cache: 'no-cache' });
  if (res.ok) {
    const copy = res.clone();
    const url = new URL(req.url);
    url.search = ''; // index.html?v=2 and index.html are the same file
    caches.open(CACHE).then(cache => cache.put(url.href, copy));
  }
  return res;
}

async function networkFirst(req) {
  const saved = () => caches.match(req, { ignoreSearch: true });
  try {
    // Give the internet 4 seconds; with a weak signal, use the saved copy instead.
    const res = await Promise.race([
      fetchAndSave(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
    ]);
    return res;
  } catch {
    const hit = await saved();
    if (hit) return hit;
    if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
    return Response.error();
  }
}
