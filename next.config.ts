import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The development badge sits on top of the phone bottom bar's "Calls" button.
  devIndicators: false,
  // Ask's SQL check (lib/ai/sqlGuard.ts) uses Postgres's parser, which loads
  // a .wasm file from beside its own script: keep it out of the bundle and
  // ship the file with the route.
  serverExternalPackages: ["libpg-query"],
  outputFileTracingIncludes: {
    "/api/ask": ["./node_modules/libpg-query/wasm/**/*"],
  },
  // The offline service worker (SPEC 11.7): always fetch the newest copy.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
