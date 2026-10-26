// =============================================================
// PooprScoopr service worker
// =============================================================
// This small file is what lets the game be INSTALLED (added to a phone
// or computer's home screen) and played OFFLINE. Browsers only run a
// service worker from its own file on the same website, which is why
// this cannot live inside index.html.
//
// How it works, in plain terms:
//   1. The first time the game loads, this worker saves ("caches") the
//      game's own files - the page, its icons and the manifest.
//   2. It also saves the outside files the page pulls in (three.js from
//      the CDN, the fonts) the first time they are fetched.
//   3. After that, if there is no internet, the saved copies are used.
//
// Privacy: this worker only stores the game's own files. It never sees
// or stores anything you type, and it sends nothing anywhere.

// Change this name whenever a new version of the game is published.
// A new name makes every player's browser throw the old copies away and
// save fresh ones, so nobody gets stuck on an old version.
const CACHE_NAME = 'pooprscoopr-v1.7.8';

// The game's own files, saved when the worker is first installed.
const CORE_FILES = [
  './',
  './index.html',
  './badges.html',             // the public badge list
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

// Outside sites we are willing to keep copies from. Anything else is
// simply passed through to the internet and never stored.
const TRUSTED_HOSTS = [
  'cdnjs.cloudflare.com',      // three.js
  'fonts.googleapis.com',      // the font stylesheet
  'fonts.gstatic.com'          // the font files
];

// The 3D engine lives on a CDN. We save a copy of it up front too, so the
// game works offline even if it has only ever been opened once.
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

// 1. INSTALL: save the core files (and, if we can, the 3D engine).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_FILES).then(() =>
        // A copy of three.js. "no-cors" is how a plain <script> tag fetches
        // it, so this copy matches what the page asks for. If it fails (no
        // internet right now) that is fine - it gets saved on first use.
        fetch(THREE_URL, { mode: 'no-cors' })
          .then((response) => cache.put(THREE_URL, response))
          .catch(() => {})
      ))
      .then(() => self.skipWaiting())        // start working straight away
  );
});

// 2. ACTIVATE: delete the saved copies from any older version.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// 3. FETCH: every time the page asks for a file.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;            // only plain downloads

  const url = new URL(request.url);
  const sameSite = (url.origin === self.location.origin);
  const trusted = TRUSTED_HOSTS.includes(url.hostname);
  if (!sameSite && !trusted) return;               // not ours - leave it alone

  // The online features (leaderboard and save codes, under /api/) must
  // always talk to the real server - never a saved copy.
  if (sameSite && url.pathname.startsWith('/api/')) return;

  // The game's "Check for updates" asks for files with cache "no-store" or
  // "reload", meaning "the real thing from the website, not a saved copy".
  // Let those go straight to the internet, untouched and unsaved.
  if (request.cache === 'no-store' || request.cache === 'reload') return;

  // The game page itself: try the internet first so players get updates,
  // and fall back to the saved copy when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else (three.js, fonts, icons): use the saved copy if we
  // have one, otherwise download it and save it for next time.
  event.respondWith(
    caches.match(request).then((saved) => {
      if (saved) return saved;
      return fetch(request).then((response) => {
        // Only keep good responses (an "opaque" CDN response is fine too).
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
