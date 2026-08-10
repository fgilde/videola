// The browser build's own update path, and its offline one. Hand-written rather than generated,
// because what may be cached here is not a detail: an editor whose bundle is served from a stale
// cache is an editor that silently runs last month's code, and there is no worse fault a service
// worker can have.
//
// Two rules, and they follow from how Vite names what it builds:
//
//   * Assets carry a content hash in the name. A file at that URL can never change, so it is served
//     from the cache and only fetched once. This is what makes a second visit instant and an offline
//     one possible at all.
//   * Everything else -- the document above all -- goes to the network first. That is the request
//     that tells the browser a new build exists, and a cached answer to it would pin the whole
//     application to whatever was current the first time it was opened.
//
// `skipWaiting` is never called on its own. A worker that took over while the editor was running
// would swap the bundle under a session with unsaved work in it; the page asks for it, after telling
// somebody that a new version is ready.
const CACHE = "videola-v1";

const IMMUTABLE = /-[A-Za-z0-9_]{8,}\.(?:js|css|wasm|woff2|png|webp|jpg|svg)$/;

// What may be cached at all, beyond the document. Anything else is left to the network untouched --
// this worker answers requests for *files*, and a request that is not one is somebody's business, not
// its own. An earlier version cached every same-origin GET, which swept up the control requests the
// test harness makes; under a virtual clock every one of them is a pause, and a cache write hung on
// each meant the editor never got a turn to draw. The narrow rule is also the correct one for a real
// session: an API answer in an offline cache is a wrong answer served confidently.
const CACHEABLE = /\.(?:js|css|wasm|woff2|png|webp|jpg|jpeg|svg|ico|webmanifest|html|mp4)$/;

self.addEventListener("install", () => {
  // Nothing is precached: the asset names are decided by a build this file knows nothing about, and
  // a list written here would be a list to keep in step by hand. The first visit fills the cache as
  // it goes, and every visit after it is served from what that one left behind.
});

self.addEventListener("activate", (event) => {
  // Old caches go; the running page does not change hands. `clients.claim()` belongs here in most
  // examples and would contradict everything above it: it makes a freshly activated worker take over
  // pages that are already open, which is the swap-under-a-session this file exists to avoid. It also
  // broke the application harness outright -- every request the running editor had in flight changed
  // owner mid-run and the effect shelf drew none of its tiles. A page gets this worker when it next
  // loads, which is the reload somebody asked for.
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name);
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  // The page's decision, not this worker's: see the note above.
  if (event.data === "take-over") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(fromCacheFirst(request));
    return;
  }
  // The document itself, whatever its path: this is the request that tells the browser a new build
  // exists, so it goes to the network first and is only served from the cache when there is none.
  if (request.mode === "navigate" || CACHEABLE.test(url.pathname)) {
    event.respondWith(fromNetworkFirst(request));
  }
});

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit !== undefined) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function fromNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    // Offline. A navigation falls back to whatever document was last seen, which is what makes the
    // editor open at all without a network; anything else falls back to its own last copy.
    const hit = await cache.match(request);
    if (hit !== undefined) return hit;
    if (request.mode === "navigate") {
      const document = await cache.match("./");
      if (document !== undefined) return document;
    }
    throw error;
  }
}
