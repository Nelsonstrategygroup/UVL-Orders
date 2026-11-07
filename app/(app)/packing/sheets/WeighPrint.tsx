// The Weigh Sheet as printed pages (Lucas, 11/1/26): Letter landscape, two
// columns, a section per product A to Z with its name large, a row per store
// with a cell per box and Total lbs. Page 1 has a one-line index of which
// page each product is on; every page has the INV#, the packing date and
// "Page 2 of 5". Pages are laid out in lib/packSheets.ts with the same sizes
// used here, so a section is never split unless it can't fit in a column.

import PrintHeader from "@/components/PrintHeader";
import { fmt } from "@/lib/calc/num";
import { weekName } from "@/lib/dates";
import { WEIGH, weighLines, type WeighLayout } from "@/lib/packSheets";

const inch = (v: number) => `${v}in`;

export default function WeighPrint({ layout, inv, week, preview = false }: { layout: WeighLayout; inv: string | null; week: string; preview?: boolean }) {
  const { sections, pages, pageOf } = layout;
  const spare = sections.length;
  const total = pages.length;
  return (
    <div className={`sheetpages ${preview ? "preview" : "print-only"}`} style={{ "--pw": inch(WEIGH.pageW), "--ph": inch(WEIGH.pageH), "--rowh": inch(WEIGH.rowH) } as React.CSSProperties}>
      {!preview && <style>{`@media print { @page { size: letter landscape; margin: 0.4in; } }`}</style>}
      {pages.map((pg, i) => (
        <section key={i} className="sp-page" aria-label={`Weigh Sheet page ${i + 1} of ${total}`}>
          <div className="sp-head" style={{ height: inch(WEIGH.pageHead) }}>
            <PrintHeader inv={inv} title="Weigh Sheet" when={`Packing ${weekName(week)} · Page ${i + 1} of ${total}`} footer={false} />
          </div>
          {i === 0 && (
            <p className="ws-index" style={{ height: inch(WEIGH.index) }}>
              <b>Products:</b>{" "}
              {sections.map((s, k) => (
                <span key={s.productId}>
                  {s.name} <b>p{pageOf[k]}</b>
                  {" · "}
                </span>
              ))}
              <span>
                Not on the sheet <b>p{pageOf[spare]}</b>
              </span>
            </p>
          )}
          <div className="sp-cols" style={{ gap: inch(WEIGH.colGap) }}>
            {pg.cols.map((col, c) => (
              <div key={c} className="sp-col">
                {col.map((piece) =>
                  piece.block === spare ? (
                    <div key="spare" className="ws-sec">
                      <div className="ws-sechead" style={{ height: inch(WEIGH.head) }}>
                        <h2>Boxes not on the sheet</h2>
                        <div className="ws-cols ws-sparecols">
                          <span>Product</span>
                          <span>Customer</span>
                          <span>Weight</span>
                        </div>
                      </div>
                      {Array.from({ length: piece.to - piece.from }, (_, r) => (
                        <div key={r} className={`ws-row ws-spare ${r % 2 ? "zebra" : ""}`} style={{ height: inch(WEIGH.rowH) }}>
                          <i className="ws-line" />
                          <i className="ws-line" />
                          <i className="ws-cell" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div key={`${piece.block}-${piece.from}`} className="ws-sec">
                      <div className="ws-sechead" style={{ height: inch(WEIGH.head) }}>
                        <h2>
                          {sections[piece.block].name}
                          {piece.cont && <span className="ws-cont"> (continued)</span>}
                        </h2>
                        <div className="ws-cols">
                          <span>Customer</span>
                          <span>Ordered</span>
                          <span>Box weights (lb)</span>
                          <span>Total lbs</span>
                        </div>
                      </div>
                      {sections[piece.block].rows.slice(piece.from, piece.to).map((r, k) => {
                        const zebra = (piece.from + k) % 2 === 1;
                        return (
                          <div
                            key={r.order.id}
                            className={`ws-row ${zebra ? "zebra" : ""}`}
                            style={{ height: inch(weighLines(r) * WEIGH.rowH) }}
                          >
                            <div className="ws-cust">{r.customer}</div>
                            <div className="ws-ord">
                              {/* Taken in pounds: the whole pieces, the pounds small underneath (Lucas, 11/7/26). */}
                              {(() => {
                                const m = r.ordered.match(/^(.*) \((.* ordered)\)$/);
                                return m ? (
                                  <>
                                    {m[1]}
                                    <small>{m[2]}</small>
                                  </>
                                ) : (
                                  r.ordered
                                );
                              })()}
                              {!r.row.known && <small>box count unknown</small>}
                            </div>
                            <div className="ws-cells">
                              {r.row.blanks.map((b) => (
                                <i key={b.slot} className="ws-cell">
                                  {b.weight ? fmt(b.weight.weight) : ""}
                                </i>
                              ))}
                            </div>
                            <i className="ws-cell ws-total">{r.row.total > 0 ? fmt(r.row.total) : ""}</i>
                          </div>
                        );
                      })}
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
