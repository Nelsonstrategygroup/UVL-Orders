// The Order grid report on paper (Lucas, 11/13/26 and 11/14/26): print only.
// The screen keeps its own table. See lib/orderGridReportPrint.ts for what
// prints. One strong signal down the page: shaded columns and a heavy line
// between groups; faint lines between rows and a small gap after every 4.
//
// Pages are laid out here, not left to the browser, so a long section can say
// "Continued" at the foot of each page but its last: every page has the
// heading ("INV# 3004", "Order grid") and both header rows; totals print once,
// at the end of the section; a section starts on a new page.

import PrintHeader from "@/components/PrintHeader";
import { flowItems, flowPages, type FlowItem, type GridReportCell, type GridReportPrint } from "@/lib/orderGridReportPrint";

/** The customer column (inches). */
const NAME_IN = 1.8;
/** What a landscape Letter page gives the table, inside 0.3 in margins (inches, px). */
const PAGE_W_IN = 10.4;
const PAGE_H_PX = 7.9 * 96;
/** Above the lines: the page heading and both header rows (px; measured on the Nov 16 PDF, with room to spare). */
const TOP_PX = 125;
/** A fixed gap kept free at the foot of every page (px). */
const FOOT_PX = 0.3 * 96;
const SIZES = { row: 28, label: 20, gap: 8, total: 28, more: 22 };
/** On a section that fits one page, rows grow to fill it, within these (px). */
const ROW_MIN_PX = 22;
const ROW_MAX_PX = 36;

type Row = GridReportPrint["rows"][number];

/** The number in the column's unit; what was ordered small under it when it was in another unit. */
function Cell({ v }: { v: GridReportCell | undefined }) {
  if (!v) return null;
  return (
    <>
      {v.n}
      {v.was && <small>{v.was}</small>}
    </>
  );
}

export default function OrderGridPrint({ g, inv }: { g: GridReportPrint; inv: string }) {
  // Every product column the same width on both sections: the widest section fills the page.
  const colIn = Math.min(0.85, (PAGE_W_IN - NAME_IN) / Math.max(1, g.slots));
  const room = PAGE_H_PX - TOP_PX - FOOT_PX;
  return (
    <div className="print-only ogr" lang="en">
      <style>{`@media print { @page { size: letter landscape; margin: 0.3in; } }`}</style>
      {g.sections.map((s, i) => {
        const cls = (c: { bandStart: boolean }, j: number) => [j % 2 ? "alt" : "", c.bandStart ? "gs" : ""].filter(Boolean).join(" ") || undefined;
        // Only customers with something in this section, under their group's label (11/14/26).
        const items = flowItems(g.rows.filter((r) => s.columns.some((c) => r.cells[c.id])));
        const nRows = items.filter((it) => it.kind === "row").length;
        const fixed = items.reduce((t, it) => t + (it.kind === "label" ? SIZES.label : it.gapAfter ? SIZES.gap : 0), 0);
        // All on one page: rows grow to fill it. Otherwise the standard height, over as many pages as it takes.
        const fill = Math.floor((room - SIZES.total - fixed) / Math.max(1, nRows));
        const rowPx = fill >= SIZES.row ? Math.min(ROW_MAX_PX, fill) : SIZES.row;
        const pages: FlowItem<Row>[][] = fill >= ROW_MIN_PX && fill >= SIZES.row ? [items] : flowPages(items, { ...SIZES, room });
        return pages.map((page, p) => {
          const last = p === pages.length - 1;
          return (
            <section key={`${i}-${p}`} className="ogr-page">
              <PrintHeader label={inv} title={<h1>Order grid</h1>} footer={i === 0 && p === 0} />
              <table className="ogr-table" style={{ width: `${NAME_IN + s.columns.length * colIn}in` }}>
                <colgroup>
                  <col style={{ width: `${NAME_IN}in` }} />
                  {s.columns.map((c) => (
                    <col key={c.id} style={{ width: `${colIn}in` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="band">
                    <th />
                    {s.bands.map((b, k) => (
                      <th key={k} colSpan={b.span} className={k > 0 ? "gs" : undefined}>
                        {b.label}
                      </th>
                    ))}
                  </tr>
                  <tr className="head">
                    <th className="name">Customer</th>
                    {s.columns.map((c, j) => (
                      <th key={c.id} className={cls(c, j)}>
                        {c.head}
                        <small>{c.unit}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.flatMap((it, k) =>
                    it.kind === "label"
                      ? [
                          <tr key={k} className="grp" style={{ height: `${SIZES.label}px` }}>
                            <td colSpan={s.columns.length + 1}>{it.label}</td>
                          </tr>,
                        ]
                      : [
                          <tr key={k} style={{ height: `${rowPx}px` }}>
                            <td className="name">{it.row.name}</td>
                            {s.columns.map((c, j) => (
                              <td key={c.id} className={cls(c, j)}>
                                <Cell v={it.row.cells[c.id]} />
                              </td>
                            ))}
                          </tr>,
                          ...(it.gapAfter && k < page.length - 1
                            ? [
                                <tr key={`${k}-gap`} className="gap" aria-hidden="true" style={{ height: `${SIZES.gap}px` }}>
                                  <td colSpan={s.columns.length + 1} />
                                </tr>,
                              ]
                            : []),
                        ],
                  )}
                  {last && (
                    <tr className="tot" style={{ height: `${SIZES.total}px` }}>
                      <td className="name">Total</td>
                      {s.columns.map((c, j) => (
                        <td key={c.id} className={cls(c, j)}>
                          {g.totals[c.id]}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
              {!last && <p className="ogr-more">Continued</p>}
            </section>
          );
        });
      })}
    </div>
  );
}
