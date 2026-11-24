// LineLab service worker: works offline (BLUEPRINT §2.2 N). Designs, tracks, the simulator and
// the emulated firmware all run in the browser, so with the app's code cached the whole studio
// works without a network. Never caches /api/ (compile, AI, gallery, sign-in).
const VERSION = "linelab-v1";
const SHELL = ["/", "/build", "/build/edit", "/tracks", "/components", "/learn", "/gallery"];

async function precache() {
  const cache = await caches.open(VERSION);
  for (const url of SHELL) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      await cache.put(url, res.clone());
      // And the scripts and styles the page loads up front.
      const html = await res.text();
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) ?? [])];
      await Promise.all(
        assets.map((a) =>
          cache
            .match(a)
            .then((hit) => hit ?? fetch(a).then((r) => (r.ok ? cache.put(a, r) : undefined))),
        ),
      );
    } catch {
      // offline during install: cached on first visit instead
    }
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  // Pages: network first (fresh when online), the cached copy offline. Query strings (design
  // ids) don't change the page, so the cache key is the path.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(VERSION).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(url.pathname)
            .then((hit) => hit ?? caches.match("/"))
            .then((hit) => hit ?? new Response("Offline", { status: 503 })),
        ),
    );
  }
});
