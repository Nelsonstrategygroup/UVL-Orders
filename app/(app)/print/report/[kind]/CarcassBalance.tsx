// The Carcass balance report as a page (Lucas, 10/29/26): the summary, then
// each part as a subtraction (From, minus each use, = Left over), then Le
// Trim. The numbers come from lib/calc/carcassReport.ts; the download is the
// same report as rows.

import { Fragment } from "react";
import { qtyWords, type CarcassReport, type ReportSection } from "@/lib/calc/carcassReport";
import { fmt } from "@/lib/calc/num";

export default function CarcassBalance({ r }: { r: CarcassReport }) {
  const q = (s: Pick<ReportSection, "unit" | "part">, pieces: number) => qtyWords(pieces, s.unit, s.part);
  const short = r.sections.some((s) => s.result.kind === "short");
  return (
    <div className="cb">
      <section className="cb-summary">
        <p className="cb-lambs">
          <b>{r.lambsLine}</b>
        </p>
        {r.sourceLine && <p>{r.sourceLine}</p>}
        <p>
          {r.cutLambs} lambs are cut into the parts below.{r.setLine ? ` ${r.setLine}` : ""}
        </p>
        <p className={short ? "cb-short" : "cb-ok"}>
          <b>{r.statusLine}</b>
          {r.tightLine ? ` ${r.tightLine}` : ""}
        </p>
        {r.guessLine && <p className="small">{r.guessLine}</p>}

        <table className="cb-compact">
          <thead>
            <tr>
              <th>Part</th>
              <th className="num">From {r.cutLambs} lambs</th>
              <th className="num">Orders take</th>
              <th className="num">Left over</th>
            </tr>
          </thead>
          <tbody>
            {r.compact.map((g) => (
              <Fragment key={g.title}>
                <tr className="cb-group">
                  <th colSpan={4}>{g.title}</th>
                </tr>
                {g.rows.map((x) => (
                  <tr key={x.part.id}>
                    <td>
                      {x.part.name}
                      {x.fromCut && <span className="small muted"> (cut from whole loins)</span>}
                    </td>
                    <td className="num">{q(x, x.from)}</td>
                    <td className="num">{q(x, x.take)}</td>
                    <td className={`num ${x.left != null && x.left < 0 ? "cb-neg" : ""}`}>
                      {x.leftText ?? (x.left != null && x.left < 0 ? `Short ${q(x, -x.left)}` : q(x, x.left ?? 0))}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>

      {r.sections.map((s) => (
        <section key={s.part.id} className="cb-part">
          <h3>{s.part.name}</h3>
          <table className="cb-sub">
            <tbody>
              <tr className="cb-from">
                <td>{s.from.label}</td>
                <td className="num">{q(s, s.from.pieces)}</td>
              </tr>
              {s.minus.map((m, i) => (
                <tr key={i}>
                  <td className="cb-minus">
                    <span aria-hidden="true">− </span>
                    {m.label}
                  </td>
                  <td className="num">{q(s, m.pieces)}</td>
                </tr>
              ))}
              <tr className={`cb-result ${s.result.kind === "short" ? "cb-neg" : ""}`}>
                <td>
                  {s.result.kind === "cut" ? "= " : ""}
                  {s.result.label}
                </td>
                <td className="num">{q(s, s.result.pieces)}</td>
              </tr>
            </tbody>
          </table>
          {s.note && <p className="small mt-1 mb-0">{s.note}</p>}
        </section>
      ))}

      {r.leTrim && (
        <section className="cb-part">
          <h3>Le Trim ({r.leTrim.planned ? "Kathy's plan" : "worked out"})</h3>
          <p className="mt-0">
            {fmt(r.leTrim.orderedLb)} lb ordered: {r.leTrim.units} units of {r.leTrim.unitLb} lb. Filled by weight:
          </p>
          <table className="cb-sub">
            <tbody>
              <tr>
                <td className="cb-minus">
                  Shoulders boned out: {r.leTrim.shoulders} × {fmt(r.leTrim.shoulderLb)} lb
                </td>
                <td className="num">{fmt(Math.round(r.leTrim.shoulders * r.leTrim.shoulderLb * 100) / 100)} lb</td>
              </tr>
              <tr>
                <td className="cb-minus">
                  Half legs: {r.leTrim.halfLegs} × {fmt(r.leTrim.halfLegLb)} lb ({Math.ceil(r.leTrim.halfLegs / 2)} legs halved)
                </td>
                <td className="num">{fmt(Math.round(r.leTrim.halfLegs * r.leTrim.halfLegLb * 100) / 100)} lb</td>
              </tr>
              <tr>
                <td className="cb-minus">Trim</td>
                <td className="num">{fmt(r.leTrim.trimLb)} lb</td>
              </tr>
              <tr className="cb-result">
                <td>
                  Total, about {fmt(Math.floor(r.leTrim.totalLb / r.leTrim.unitLb))} units
                </td>
                <td className="num">{fmt(r.leTrim.totalLb)} lb</td>
              </tr>
              <tr className={r.leTrim.diffLb < 0 ? "cb-neg" : undefined}>
                <td>{r.leTrim.diffLb < 0 ? "Short of what's ordered" : r.leTrim.diffLb > 0 ? "More than what's ordered" : "Exactly what's ordered"}</td>
                <td className="num">{r.leTrim.diffLb ? `${fmt(Math.abs(r.leTrim.diffLb))} lb` : ""}</td>
              </tr>
            </tbody>
          </table>
          <p className="small mt-1 mb-0">At the averages in Setup &gt; Le Trim; average-size lambs.</p>
        </section>
      )}

      {r.notOrdered && <p className="mt-3">{r.notOrdered}</p>}
    </div>
  );
}
