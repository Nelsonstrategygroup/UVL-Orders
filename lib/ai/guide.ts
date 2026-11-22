// The data guide cut down to what one reader can see: the General notes plus
// the sections for the views it can SELECT. Nothing about other views is sent,
// so the model doesn't learn the names of data it can't read.

import { DATA_GUIDE } from "./dataGuide";

type Guide = { general: string; views: Map<string, string> };

export function parseGuide(md: string): Guide {
  const text = md.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->\n?/g, "");
  const [head, body = ""] = text.split(/^## Views\s*$/m);
  const general = head.trim();
  const views = new Map<string, string>();
  for (const part of body.split(/^(?=### )/m)) {
    const m = part.match(/^### (\S+)\n/);
    if (m) views.set(m[1], part.trim());
  }
  return { general, views };
}

const PARSED = parseGuide(DATA_GUIDE);

/** The guide for a reader that can SELECT exactly these views. */
export function guideFor(allowedViews: readonly string[]): string {
  const sections = allowedViews
    .filter((v) => PARSED.views.has(v))
    .sort()
    .map((v) => PARSED.views.get(v)!);
  return `${PARSED.general}\n\n## Views you can read\n\n${sections.join("\n\n")}\n`;
}

export function guideViewNames(): string[] {
  return [...PARSED.views.keys()];
}
