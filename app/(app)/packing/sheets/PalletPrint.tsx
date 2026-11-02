// The Pallet Sheet as printed pages (Lucas, 11/1/26): Letter portrait, two
// columns, a block per store in the usual order with Ships to, Pallet and
// Initials once, then a line per product: a checkbox, the product as on the
// label, what was ordered, and how many boxes. No weight blanks (those are
// on the Weigh Sheet). Laid out in lib/packSheets.ts with these sizes.

import PrintHeader from "@/components/PrintHeader";
import { weekName } from "@/lib/dates";
import { PALLET, shortGroup, type PalletCustomer } from "@/lib/packSheets";
import type { Page } from "@/lib/calc/printPages";

const inch = (v: number) => `${v}in`;

export default function PalletPrint({
  customers,
  pages,
  inv,
  week,
  preview = false,
}: {
  customers: PalletCustomer[];
  pages: Page[];
  inv: string | null;
  week: string;
  preview?: boolean;
}) {
  const total = pages.length;
  return (
    <div className={`sheetpages ${preview ? "preview" : "print-only"}`} style={{ "--pw": inch(PALLET.pageW), "--ph": inch(PALLET.pageH) } as React.CSSProperties}>
      {!preview && <style>{`@media print { @page { size: letter portrait; margin: 0.4in; } }`}</style>}
      {pages.map((pg, i) => (
        <section key={i} className="sp-page" aria-label={`Pallet Sheet page ${i + 1} of ${total}`}>
          <div className="sp-head" style={{ height: inch(PALLET.pageHead) }}>
            <PrintHeader inv={inv} title="Pallet Sheet" when={`Packing ${weekName(week)} · Page ${i + 1} of ${total}`} footer={false} />
          </div>
          <div className="sp-cols" style={{ gap: inch(PALLET.colGap) }}>
            {pg.cols.map((col, c) => (
              <div key={c} className="sp-col">
                {col.map((piece) => {
                  const cu = customers[piece.block];
                  return (
                    <div key={`${piece.block}-${piece.from}`} className="pl-cust">
                      <div className="pl-head" style={{ height: inch(PALLET.head) }}>
                        <h2>
                          {cu.customer}
                          {piece.cont && <span className="ws-cont"> (continued)</span>}
                        </h2>
                        {/* Ships to, Pallet and Initials once per store, not on a continuation. */}
                        {piece.cont ? (
                          <div className="pl-meta" />
                        ) : (
                          <div className="pl-meta">
                            <span className="pl-ship">{cu.shipsTo}</span>
                            <span>
                              Pallet <i className="pl-blank" />
                            </span>
                            <span>
                              Initials <i className="pl-blank" />
                            </span>
                          </div>
                        )}
                      </div>
                      {cu.lines.slice(piece.from, piece.to).map((l, k) => (
                        <div key={l.productId} className={`pl-line ${(piece.from + k) % 2 ? "zebra" : ""}`} style={{ height: inch(PALLET.lineH) }}>
                          <span className="pl-ck" aria-hidden="true">
                            ☐
                          </span>
                          <span className="pl-prod">{l.name}</span>
                          <span className="pl-ord">{l.ordered.includes(", ") ? shortGroup(l.ordered) : l.ordered}</span>
                          <span className="pl-boxes">
                            {l.boxes} box{l.boxes === "1" ? "" : "es"}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
