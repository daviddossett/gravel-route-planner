// Offline support for Gravel Atlas.
// - App shell + same-origin files: network first (short timeout), cached copy when offline.
// - Cross-origin scripts, styles, and fonts: cached copy first, refreshed in the background.
// - Map tiles: only tiles the rider has already viewed, capped, and kept for the 7 days
//   OpenTopoMap's cache headers allow. Nothing is prefetched or bulk-downloaded.
const VERSION = "v1";
const SHELL = `atlas-shell-${VERSION}`;
const ASSETS = `atlas-assets-${VERSION}`;
const TILES = `atlas-tiles-${VERSION}`;
const MAX_TILES = 400;
const TILE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NETWORK_TIMEOUT = 3000;
const PRECACHE = ["./", "./index.html", "./offline.js", "../../data/routes.js"];
const TILE_PATH = /\/\d+\/\d+\/\d+\.(png|jpe?g|webp)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  const keep = [SHELL, ASSETS, TILES];
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("atlas-") && !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page reports what it loaded before this worker took control, so the first visit is cached too.
self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "cache-urls") return;
  e.waitUntil(Promise.all(e.data.urls.map(async (u) => {
    const url = new URL(u, self.location.href);
    const same = url.origin === self.location.origin;
    const cacheName = same ? SHELL : ASSETS;
    const cache = await caches.open(cacheName);
    if (await cache.match(url.href)) return;
    try {
      const res = await fetch(url.href, { mode: same ? "same-origin" : "cors", credentials: "omit" });
      if (res.status === 200) await cache.put(url.href, res);
    } catch (_) { /* best effort */ }
  })));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  } else if (req.destination === "image" && TILE_PATH.test(url.pathname)) {
    e.respondWith(tile(req, e));
  } else if (["script", "style", "font"].includes(req.destination) || url.hostname.startsWith("fonts.")) {
    e.respondWith(staleWhileRevalidate(req, e));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const network = fetch(req).then((res) => {
    if (res.status === 200) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  network.catch(() => {});
  const fromCache = () => cache.match(req, { ignoreSearch: req.mode === "navigate" })
    .then((hit) => hit || (req.mode === "navigate" ? cache.match("./") : undefined));
  // A weak trailhead signal shouldn't hang the page: after a few seconds, use the saved copy.
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT)).then(fromCache);
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return await network;
  } catch (err) {
    const hit = await fromCache();
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res.status === 200) return cache.put(req, res.clone()).then(() => res, () => res);
    return res;
  });
  if (hit) {
    e.waitUntil(network.catch(() => {}));
    return hit;
  }
  return network;
}

async function tile(req, e) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit && Date.now() - Number(hit.headers.get("x-atlas-cached-at") || 0) < TILE_MAX_AGE) return hit;
  try {
    const res = await fetch(req);
    // Only CORS responses: opaque tiles are unreadable and count heavily against storage quota.
    if (res.status === 200 && res.type === "cors") e.waitUntil(stamp(res.clone()).then((r) => cache.put(req, r)).then(() => trim(cache)));
    return res;
  } catch (err) {
    if (hit) return hit;
    throw err;
  }
}

async function stamp(res) {
  const headers = new Headers(res.headers);
  headers.set("x-atlas-cached-at", String(Date.now()));
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}
