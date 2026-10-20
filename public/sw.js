// Service worker for offline Packing (SPEC 11.7). Keeps Packing and Scan boxes
// on the phone so they open with no signal (inside the Mohawk freezer).
//
// - Pages under /packing: from the network when there's signal (and kept),
//   otherwise the kept copy.
// - The app's code and files (/_next/static, /zxing, /icons): kept once
//   loaded; these never change under the same name.
// - Everything else (the database, other pages, logins) goes straight to the
//   network. Data on the phone lives in IndexedDB, not here.

const VERSION = "uvl-sw-1";
const PAGES = `${VERSION}-pages`;
const FILES = `${VERSION}-files`;
const PAGE_TIMEOUT_MS = 6000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [PAGES, FILES];
      for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

const isPackingPage = (url) => url.pathname === "/packing" || url.pathname.startsWith("/packing/");
const isFile = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/zxing/") ||
  url.pathname.startsWith("/icons/") ||
  url.pathname === "/manifest.webmanifest";

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function page(request) {
  const url = new URL(request.url);
  const cache = await caches.open(PAGES);
  try {
    const res = await Promise.race([fetch(request), timeout(PAGE_TIMEOUT_MS)]);
    // Keep real pages only, not a redirect to the login page.
    if (res.ok && !res.redirected && isPackingPage(new URL(res.url))) await cache.put(url.pathname, res.clone());
    return res;
  } catch {
    const kept = (await cache.match(url.pathname)) || (await cache.match("/packing"));
    if (kept) return kept;
    return new Response(
      "<!doctype html><meta name=viewport content='width=device-width'><title>No signal</title>" +
        "<body style='font-family:sans-serif;padding:24px'><h1>No signal</h1>" +
        "<p>Packing hasn't been opened on this phone with signal yet, so it can't open now. Find signal, open Packing once, and it will work in the freezer after that.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

async function file(request) {
  const cache = await caches.open(FILES);
  const kept = await cache.match(request);
  if (kept) return kept;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && isPackingPage(url)) {
    event.respondWith(page(request));
    return;
  }
  if (isFile(url)) event.respondWith(file(request));
});
