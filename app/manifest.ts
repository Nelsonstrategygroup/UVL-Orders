import type { MetadataRoute } from "next";

// Home screen install (SPEC 3). Addresses come from NEXT_PUBLIC_SITE_URL so
// moving to a new domain needs no code change (SPEC 2.1).
export default function manifest(): MetadataRoute.Manifest {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  return {
    name: "Umpqua Valley Lamb Orders",
    short_name: "UVL Orders",
    description: "Weekly orders, cut sheet, and packing for Umpqua Valley Lamb.",
    id: `${site}/`,
    start_url: `${site}/`,
    scope: `${site}/`,
    display: "standalone",
    background_color: "#F1EFE3",
    theme_color: "#3B5E27",
    icons: [
      { src: `${site}/icons/192`, sizes: "192x192", type: "image/png" },
      { src: `${site}/icons/512`, sizes: "512x512", type: "image/png" },
      { src: `${site}/icons/512-maskable`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
