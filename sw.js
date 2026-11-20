/* Planner 2.8 — service worker.
   The page itself: fresh from the server whenever the server answers, so a new version lands the first time; the kept copy
   at once when offline; the kept copy after three seconds on a connection that does not answer.
   Icons and manifest: kept copy first.
   It only ever opens or clears its own cache (names starting planner28-) and never touches another planner on this site. */
const CACHE = 'planner28-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const HOME = new URL('./', self.location.href);          // …/planner28/

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => (r && r.ok ? c.put(u, r) : null)).catch(() => null))))
    .then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('planner28-') && k !== CACHE).map(k => caches.delete(k))))   // only ever our own old caches
    .then(() => self.clients.claim()));
});

/* a response that followed a redirect cannot answer a page load; hand back a clean copy of it */
function clean(res) { return res && res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res; }
function kept() { return caches.open(CACHE).then(c => c.match('./index.html').then(r => r || c.match('./'))); }
function keep(res) { if (res && res.ok) { const a = res.clone(), b = res.clone(); caches.open(CACHE).then(c => Promise.all([c.put('./index.html', a), c.put('./', b)])).catch(() => {}); } }
/* when the page was last changed on the server, as the server said it (0 when it did not say) */
function madeAt(res) { const v = res && res.headers.get('last-modified'); const t = v ? Date.parse(v) : NaN; return isNaN(t) ? 0 : t; }
async function page(req, url) {
  const c = await caches.open(CACHE);
  /* he has just pressed Reload: the page put the new version in the kept copy and asks for exactly that, once */
  if (await c.match('./__kept-once')) { await c.delete('./__kept-once'); const k = await kept(); if (k) return k; }
  const fresh = fetch(url.href, { cache: req.cache === 'reload' ? 'reload' : 'no-cache', credentials: 'same-origin' }).then(async res => {
    res = clean(res);
    if (res && res.ok) { const k = await kept(); if (k && madeAt(k) && madeAt(res) && madeAt(res) < madeAt(k)) return k;   // something in front of the server still holds an older page than the one kept: do not go back to it
      keep(res); }
    return res; });
  return new Promise(resolve => {
    let done = false; const give = r => { if (!done && r) { done = true; resolve(r); } };
    const slow = setTimeout(() => { kept().then(give); }, 3000);
    fresh.then(res => { clearTimeout(slow); if (res && (res.ok || res.status === 304)) give(res); else kept().then(r => give(r || res)); })
         .catch(() => { clearTimeout(slow); kept().then(r => give(r || Response.error())); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                    // Microsoft, Google and everything else: never touched
  if (!url.pathname.startsWith(HOME.pathname)) return;                // another planner on the same site: never touched
  if (url.searchParams.has('p28check')) return;                       // the page asking "is there a newer version": straight to the server
  const rest = url.pathname.slice(HOME.pathname.length);
  if (req.mode === 'navigate' || rest === '' || rest === 'index.html') { e.respondWith(page(req, url)); return; }
  e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }))));
});
