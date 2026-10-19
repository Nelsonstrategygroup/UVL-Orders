// Reading Code 128 barcodes from the phone camera (SPEC 11.1). Works on both
// kinds of phone:
// - Android Chrome has a built-in reader (BarcodeDetector).
// - iPhone Safari doesn't, so the bundled ZXing reader is used. Its .wasm file
//   is served from this site (public/zxing), not a CDN, so it also works
//   offline once loaded.
// Browser only.

export type FrameReader = {
  /** "built-in" or "bundled", for the screen to show. */
  kind: "built-in" | "bundled";
  /** Barcode texts found in the current video frame (GS1 symbology prefix "]C1" kept when known). */
  read(video: HTMLVideoElement): Promise<string[]>;
};

// The reader's .wasm file, copied from node_modules/zxing-wasm/dist/reader
// (version pinned in package.json).
const ZXING_WASM = "/zxing/zxing_reader-3.1.4.wasm";

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> };
type DetectorClass = {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

async function builtIn(): Promise<FrameReader | null> {
  const D = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!D) return null;
  try {
    const formats = await D.getSupportedFormats();
    if (!formats.includes("code_128")) return null;
  } catch {
    return null;
  }
  const detector = new D({ formats: ["code_128"] });
  return {
    kind: "built-in",
    async read(video) {
      const found = await detector.detect(video);
      return found.map((b) => b.rawValue).filter(Boolean);
    },
  };
}

async function bundled(): Promise<FrameReader> {
  const z = await import("zxing-wasm/reader");
  z.prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? ZXING_WASM : prefix + path) },
    fireImmediately: true,
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return {
    kind: "bundled",
    async read(video) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return [];
      // The middle band of the picture, where the guide line is: smaller and faster.
      const band = Math.round(h * 0.5);
      canvas.width = w;
      canvas.height = band;
      ctx.drawImage(video, 0, Math.round((h - band) / 2), w, band, 0, 0, w, band);
      const results = await z.readBarcodes(ctx.getImageData(0, 0, w, band), {
        formats: ["Code128"],
        tryHarder: true,
        tryRotate: true,
        maxNumberOfSymbols: 1,
        textMode: "Plain",
      });
      return results.filter((r) => r.isValid).map((r) => `${r.symbologyIdentifier === "]C1" ? "]C1" : ""}${r.text}`);
    },
  };
}

/** The best reader this phone has. */
export async function makeFrameReader(prefer?: "built-in" | "bundled"): Promise<FrameReader> {
  if (prefer !== "bundled") {
    const b = await builtIn();
    if (b) return b;
  }
  return bundled();
}
