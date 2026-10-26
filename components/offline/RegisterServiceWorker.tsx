"use client";

// Installs public/sw.js so Packing opens with no signal (SPEC 11.7).
// Production only: a production build's code files are named by their
// content, so keeping them is safe. In development the names stay the same
// while the code changes, so a kept copy would go stale; any worker left
// from testing a production build locally is removed.

import { useEffect } from "react";

export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then(async (regs) => {
        if (!regs.length) return;
        await Promise.all(regs.map((r) => r.unregister()));
        for (const k of await caches.keys()) if (k.startsWith("uvl-sw-")) await caches.delete(k);
        location.reload();
      });
      return;
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    // On a Packing page with signal, keep all of Packing on the phone for the freezer.
    if (location.pathname.startsWith("/packing") && navigator.onLine)
      void navigator.serviceWorker.ready.then((reg) =>
        reg.active?.postMessage({ type: "keep-pages", paths: ["/packing", "/packing/scan", "/packing/pallets", "/packing/print", "/packing/paper"] }),
      );
  }, []);
  return null;
}
