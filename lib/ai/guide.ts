// The data guide cut down to what one reader can see: the General notes, the
// sections for the views it can SELECT, and the "How the app works out its
// numbers" sections whose views it can all SELECT. Nothing about other views
// is sent, so the model doesn't learn the names of data it can't read.

import { DATA_GUIDE } from "./dataGuide";

export const CALC_HEADING = "How the app works out its numbers";

/** A calculation's steps, sent only when the reader can read every view it names in `needs`. */
type Calc = { title: string; needs: string[]; text: string };
type Guide = { general: string; views: Map<string, string>; calcs: Calc[] };

export function parseGuide(md: string): Guide {
  const text = md.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->\n?/g, "");
  const [head, rest = ""] = text.split(/^## Views\s*$/m);
  const [body, calcBody = ""] = rest.split(new RegExp(`^## ${CALC_HEADING}\\s*$`, "m"));
  const general = head.trim();
  const views = new Map<string, string>();
  for (const part of body.split(/^(?=### )/m)) {
    const m = part.match(/^### (\S+)\n/);
    if (m) views.set(m[1], part.trim());
  }
  const calcs: Calc[] = [];
  for (const part of calcBody.split(/^(?=### )/m)) {
    const m = part.match(/^### (.+?) \(needs: ([^)]*)\)\n/);
    if (!m) {
      if (part.trim().startsWith("###")) throw new Error(`Calculation heading without "(needs: ...)": ${part.split("\n")[0]}`);
      continue;
    }
    const needs = m[2].split(",").map((s) => s.trim()).filter(Boolean);
    calcs.push({ title: m[1], needs, text: `### ${m[1]}\n${part.slice(m[0].length).trim()}` });
  }
  return { general, views, calcs };
}

const PARSED = parseGuide(DATA_GUIDE);

/** The guide for a reader that can SELECT exactly these views. */
export function guideFor(allowedViews: readonly string[]): string {
  const allowed = new Set(allowedViews);
  const sections = [...allowed]
    .filter((v) => PARSED.views.has(v))
    .sort()
    .map((v) => PARSED.views.get(v)!);
  const calcs = PARSED.calcs.filter((c) => c.needs.every((v) => allowed.has(v))).map((c) => c.text);
  const calcPart = calcs.length ? `\n\n## ${CALC_HEADING}\n\n${calcs.join("\n\n")}` : "";
  return `${PARSED.general}\n\n## Views you can read\n\n${sections.join("\n\n")}${calcPart}\n`;
}

export function guideViewNames(): string[] {
  return [...PARSED.views.keys()];
}

/** The calculation sections, with the views each needs (for tests). */
export function guideCalcs(): { title: string; needs: string[] }[] {
  return PARSED.calcs.map(({ title, needs }) => ({ title, needs }));
}
