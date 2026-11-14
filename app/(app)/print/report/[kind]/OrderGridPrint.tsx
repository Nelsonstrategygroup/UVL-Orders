// The Order grid report on paper (Lucas, 11/13/26): print only. The screen
// keeps its own table. See lib/orderGridReportPrint.ts for what prints.

import PrintHeader from "@/components/PrintHeader";
import { softHyphens, type GridReportPrint } from "@/lib/orderGridReportPrint";

/** The name columns, at both ends of each row (inches). */
const NAME_IN = 1.8;
/** The width a page gives the table (landscape Letter less 0.3 in margins). */
const PAGE_IN = 10.4;

/** "20 lb": the number full size, a unit after it small, so a cell never wraps. */
function Cell({ v }: { v: string | undefined }) {
  if (!v) return null;
  const [n, ...unit] = v.split(" ");
  return (
    <>
      {n}
      {unit.length > 0 && <small> {unit.join(" ")}</small>}
    </>
  );
}

export default function OrderGridPrint({ g, inv, when }: { g: GridReportPrint; inv: string; when?: string }) {
  // Every product column the same width, on both sections: the widest section fills the page.
  const colIn = Math.min(0.75, (PAGE_IN - 2 * NAME_IN) / Math.max(1, g.slots));
  return (
    <div className="print-only ogr" lang="en">
      <style>{`@media print { @page { size: letter landscape; margin: 0.3in; } }`}</style>
      {g.sections.map((s, i) => {
        const cls = (c: { bandStart: boolean }, j: number) => [j % 2 ? "alt" : "", c.bandStart ? "gs" : ""].filter(Boolean).join(" ") || undefined;
        return (
          <section key={i} className="ogr-section">
            <PrintHeader
              label={inv}
              title={<h1>Order grid</h1>}
              when={`${when ?? ""}${g.sections.length > 1 ? ` · Part ${i + 1} of ${g.sections.length}: ${s.bands.map((b) => b.label).join(", ")}` : ""}`}
              footer={i === 0}
            />
            <table className="ogr-table" style={{ width: `${2 * NAME_IN + s.columns.length * colIn}in` }}>
              <colgroup>
                <col style={{ width: `${NAME_IN}in` }} />
                {s.columns.map((c) => (
                  <col key={c.id} style={{ width: `${colIn}in` }} />
                ))}
                <col style={{ width: `${NAME_IN}in` }} />
              </colgroup>
              <thead>
                <tr className="band">
                  <th />
                  {s.bands.map((b, k) => (
                    <th key={k} colSpan={b.span} className={k > 0 ? "gs" : undefined}>
                      {b.label}
                    </th>
                  ))}
                  <th />
                </tr>
                <tr className="head">
                  <th className="name">Customer</th>
                  {s.columns.map((c, j) => (
                    <th key={c.id} className={cls(c, j)}>
                      {softHyphens(c.head)}
                      <small>{c.unit}</small>
                    </th>
                  ))}
                  <th className="name end">Customer</th>
                </tr>
                <tr className="tot">
                  <th className="name">Total</th>
                  {s.columns.map((c, j) => (
                    <th key={c.id} className={cls(c, j)}>
                      {g.totals[c.id]}
                    </th>
                  ))}
                  <th className="name end">Total</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, k) => (
                  <tr key={k} className={k % 2 ? "zebra" : undefined}>
                    <td className="name">{r.name}</td>
                    {s.columns.map((c, j) => (
                      <td key={c.id} className={cls(c, j)}>
                        <Cell v={r.cells[c.id]} />
                      </td>
                    ))}
                    <td className="name end">{r.name}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td className="name">Total</td>
                  {s.columns.map((c, j) => (
                    <td key={c.id} className={cls(c, j)}>
                      {g.totals[c.id]}
                    </td>
                  ))}
                  <td className="name end">Total</td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
