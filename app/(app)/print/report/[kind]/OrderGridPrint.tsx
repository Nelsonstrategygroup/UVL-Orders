// The Order grid report on paper (Lucas, 11/13/26 and 11/14/26): print only.
// The screen keeps its own table. See lib/orderGridReportPrint.ts for what
// prints. One strong signal down the page: shaded columns and a heavy line
// between groups; faint lines between rows, a darker one every 4 rows.

import PrintHeader from "@/components/PrintHeader";
import type { GridReportCell, GridReportPrint } from "@/lib/orderGridReportPrint";

/** The customer column (inches). */
const NAME_IN = 1.8;
/** What a landscape Letter page gives the table, inside 0.3 in margins (inches). */
const PAGE_W_IN = 10.4;
const PAGE_H_PX = 7.9 * 96;
/** Above the rows: the page header, the group bands and the column headers (px; measured on the Nov 16 PDF). */
const TOP_PX = 120;
/** The totals row, and a fixed gap kept free at the foot of the page (px). */
const FOOT_PX = 30 + 0.3 * 96;
/** Row heights: never cramped, never so tall a row stops reading as one line. */
const ROW_MIN_PX = 22;
const ROW_MAX_PX = 36;

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

export default function OrderGridPrint({ g, inv, when }: { g: GridReportPrint; inv: string; when?: string }) {
  // Every product column the same width on both sections: the widest section fills the page.
  const colIn = Math.min(0.85, (PAGE_W_IN - NAME_IN) / Math.max(1, g.slots));
  return (
    <div className="print-only ogr" lang="en">
      <style>{`@media print { @page { size: letter landscape; margin: 0.3in; } }`}</style>
      {g.sections.map((s, i) => {
        const cls = (c: { bandStart: boolean }, j: number) => [j % 2 ? "alt" : "", c.bandStart ? "gs" : ""].filter(Boolean).join(" ") || undefined;
        // Only customers with something in this section (11/14/26).
        const rows = g.rows.filter((r) => s.columns.some((c) => r.cells[c.id]));
        // Taller rows to fill the page, down to a fixed gap at the foot.
        const rowPx = Math.max(ROW_MIN_PX, Math.min(ROW_MAX_PX, Math.floor((PAGE_H_PX - TOP_PX - FOOT_PX) / Math.max(1, rows.length))));
        return (
          <section key={i} className="ogr-section">
            <PrintHeader
              label={inv}
              title={<h1>Order grid</h1>}
              when={`${when ?? ""}${g.sections.length > 1 ? ` · Part ${i + 1} of ${g.sections.length}: ${s.bands.map((b) => b.label).join(", ")}` : ""}`}
              footer={i === 0}
            />
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
                {rows.map((r, k) => (
                  <tr key={k} style={{ height: `${rowPx}px` }}>
                    <td className="name">{r.name}</td>
                    {s.columns.map((c, j) => (
                      <td key={c.id} className={cls(c, j)}>
                        <Cell v={r.cells[c.id]} />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="tot">
                  <td className="name">Total</td>
                  {s.columns.map((c, j) => (
                    <td key={c.id} className={cls(c, j)}>
                      {g.totals[c.id]}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
