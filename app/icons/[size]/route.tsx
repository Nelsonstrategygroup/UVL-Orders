// App icons (SPEC 3): a "UV" mark in forest green, the same ring as the
// header. Drawn at request time, so there are no image files to maintain.
// Sizes: 32 (browser tab), 180 (iPhone and iPad home screen), 192 and 512
// (Android). "512-maskable" leaves extra margin for round Android icons.

import { ImageResponse } from "next/og";

const FOREST = "#3B5E27";
const CREAM = "#F4F2E6";
const SIZES = new Set(["32", "180", "192", "512", "512-maskable"]);

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const px = parseInt(size, 10);
  const maskable = size.endsWith("maskable");
  const ring = Math.round(px * (maskable ? 0.62 : 0.8));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: FOREST,
        }}
      >
        <div
          style={{
            width: ring,
            height: ring,
            borderRadius: "50%",
            border: `${Math.max(2, Math.round(px * 0.045))}px solid ${CREAM}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: CREAM,
            fontSize: Math.round(ring * 0.42),
            fontWeight: 700,
            letterSpacing: -Math.round(ring * 0.01),
          }}
        >
          UV
        </div>
      </div>
    ),
    {
      width: px,
      height: px,
      headers: { "Cache-Control": "public, max-age=604800, immutable" },
    },
  );
}
