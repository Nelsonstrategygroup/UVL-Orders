// The cut sheet the way Mohawk sees it on paper (prototype csHTML): used for
// the "What Mohawk gets" preview and for printing.

import { carcassBySize, lineText, printLines, printSets, type CutSpecLite } from "@/lib/calc/cutsheet";
import { fmt, num } from "@/lib/calc/num";
import type { SizeClass } from "@/lib/db/types";
import type { CutSheetData } from "@/lib/db/cutsheet";

function slashDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

export default function MohawkSheet({
  data,
  specs,
  sizes,
  standing,
}: {
  data: CutSheetData;
  specs: Map<string, CutSpecLite>;
  sizes: SizeClass[];
  standing: string;
}) {
  const sh = data.sheet!;
  const total = data.sets.reduce((a, s) => a + num(s.lambs), 0);
  const banners = [...data.goals.map((g) => g.text), ...data.banners.map((b) => b.text)].filter((t) => t.trim());
  const carcass = carcassBySize(data.sets, specs);
  const sizeLabel = (id: string | null) => sizes.find((z) => z.id === id)?.label ?? "";

  return (
    // Scrolls sideways on narrow screens, so it can take keyboard focus to scroll.
    <div className="cs" role="region" aria-label="The cut sheet as printed" tabIndex={0}>
      <div className="cs-inner">
        <div className="cs-top">
          <div className="cs-meta">
            DATE: {slashDate(data.processDate ?? data.week)}
            <br />
            INV# {sh.inv_number}
            <br />
            Total Lamb: {total}
          </div>
          <div>
            {banners.length ? (
              banners.map((b, i) => (
                <div key={i} className={`cs-ban c${i % 3}`}>
                  {b}
                </div>
              ))
            ) : (
              <div className="cs-ban c2">&nbsp;</div>
            )}
          </div>
        </div>

        {standing.trim() && <div className="cs-std">{standing.trim()}</div>}

        {/* Lambs in whole-carcass sets, by size (SPEC 6.5, OPEN). As on Kathy's sheet, XS isn't listed. */}
        <div className="cs-sizes">
          {sizes
            .filter((z) => z.id !== "XS")
            .map((z) => (
              <div key={z.id}>
                {carcass[z.id] ?? 0}: {z.label} Lambs, {z.weight_range}
              </div>
            ))}
        </div>

        {printSets(data.sets).map((s) => (
          <div key={s.id} className="cs-set">
            <div className="cs-left">
              {s.name}
              <br />
              <u>&nbsp;{num(s.lambs)}&nbsp;</u> {sizeLabel(s.size_class_id)}
            </div>
            <div>
              {s.headline.trim() && <div className="cs-hl">{s.headline}</div>}
              {printLines(s).map((l) => (
                <div key={l.id} className={`cs-line ${l.highlight ?? ""}`}>
                  <span className="q">{l.kind === "note" || l.qty == null ? "" : fmt(l.qty)}</span>
                  <span>{lineText(l, specs)}</span>
                  <span className="sd">{l.side_note}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="cs-foot">
          <div>
            Lambs Pulled From Inventory
            <br />
            LARGE {sh.pulled_large || ""}
            <br />
            Medium {sh.pulled_medium || ""}
            <br />
            Small {sh.pulled_small || ""}
            <br />
            <br />
            TOTAL {total}
          </div>
          <div className="cs-notes">
            UVL Notes
            <br />
            {sh.notes}
          </div>
        </div>
      </div>
    </div>
  );
}
