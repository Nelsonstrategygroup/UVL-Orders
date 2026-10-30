// "How N was worked out" on This week (Lucas, 10/29/26): the lamb count step
// by step. Each part's need from the orders, product by product, over what
// one average-size lamb gives; the part that sets the count; then carcass and
// extra lambs; then Your number or the cut sheet; then Le Trim. The numbers
// come from the same calculation as the count (lib/calc/working.ts).

import Link from "next/link";
import { Fragment } from "react";
import type { LeTrimNeed } from "@/lib/calc/leTrim";
import { fmt } from "@/lib/calc/num";
import type { Part, Product } from "@/lib/calc/types";
import type { WeekCalc } from "@/lib/calc/week";
import { countWorking } from "@/lib/calc/working";
import type { ExtraLambRow } from "@/lib/db/types";

const r2 = (v: number) => Math.round(v * 100) / 100;

const REASON: Record<ExtraLambRow["reason"], string> = {
  le_trim: "Le Trim",
  freezer: "freezer stock",
  small_lambs: "small lambs",
  half_whole: "half/whole orders",
  other: "other",
};

export default function Working({
  c,
  parts,
  products,
  extraLambs,
  leTrim,
}: {
  c: WeekCalc;
  parts: Part[];
  products: Product[];
  extraLambs: ExtraLambRow[];
  leTrim: { ordered: { lb: number }; need: LeTrimNeed; spare: { shoulders: number; legs: number; trimLb: number }; planned: boolean };
}) {
  if (c.recommended === 0 && c.final === 0) return null;
  const w = countWorking(c, parts, products);
  const unit = (p: Part) => (p.unit === "lb" ? " lb" : "");
  const setter = w.parts.find((p) => p.sets);
  const carcassText = w.carcass.map((x) => `${x.product} ${fmt(x.qty)}`).join(", ");
  const extraText = extraLambs.map((x) => `${x.lambs} ${REASON[x.reason] ?? x.reason}${x.note ? ` (${x.note})` : ""}`).join(", ");

  return (
    <details className="working mt-2">
      <summary className="copy">How {c.final} was worked out</summary>
      <ol>
        <li>
          <b>What the orders need of each part, and the lambs for it.</b> Need ÷ what one average-size lamb gives, rounded up.
          The part needing the most lambs sets the count. (What a lamb gives is in{" "}
          <Link href="/setup/parts" className="copy">
            Setup &gt; Parts per lamb
          </Link>
          .)
          <table className="simple mt-1">
            <thead>
              <tr>
                <th>Part</th>
                <th className="num">Need</th>
                <th className="num">Per lamb</th>
                <th className="num">Lambs</th>
              </tr>
            </thead>
            <tbody>
              {w.parts.map((p) => (
                <Fragment key={p.part.id}>
                  <tr className={p.sets ? "font-semibold" : undefined}>
                    <td>
                      {p.part.name}
                      {p.sets && <span className="tag sets ml-1">Sets the count</span>}
                    </td>
                    <td className="num">
                      {fmt(r2(p.need))}
                      {unit(p.part)}
                    </td>
                    <td className="num">
                      {fmt(p.perLamb)}
                      {unit(p.part)}
                    </td>
                    <td className="num">{p.lambs}</td>
                  </tr>
                  <tr className="working-from">
                    <td colSpan={4} className="small">
                      {p.lines.length === 0 && p.cutFrom.every((k) => !k.need) ? (
                        <span className="muted">Nothing ordered.</span>
                      ) : (
                        <>
                          {p.lines.map((l) => `${l.product} ${fmt(l.qty)}${l.each !== 1 ? ` × ${fmt(l.each)} = ${fmt(l.total)}` : ""}`).join(" + ")}
                          {p.cutFrom.some((k) => k.need > 0) && (
                            <>
                              {p.lines.length ? " + " : ""}
                              the larger of {p.cutFrom.map((k) => `${k.part.name.toLowerCase()}s ${fmt(k.need)}`).join(" and ")} (cut from these)
                            </>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </li>
        {w.never.length > 0 && (
          <li>
            <b>Never set the count:</b>{" "}
            {[...new Set(w.never.map((n) => n.why))]
              .map((why) => {
                const names = w.never.filter((n) => n.why === why).map((n) => n.part.name.toLowerCase());
                return why === "never sets the count" ? names.join(", ") : `${names.join(" and ")} (${why})`;
              })
              .join("; ")}
            . They come with the lambs and show in the balance.
          </li>
        )}
        <li>
          <b>The count:</b> {c.orderLambs} for parts{setter ? ` (${setter.part.name.toLowerCase()})` : ""}
          {c.carcass > 0 && ` + ${c.carcass} carcass (${carcassText}, sent uncut)`}
          {c.extra > 0 && ` + ${c.extra} extra (${extraText})`} = <b>{c.recommended}</b> average-size lambs.
        </li>
        {c.source !== "orders" && (
          <li>
            <b>Used instead:</b>{" "}
            {c.source === "your number"
              ? `${c.final}, the number typed in Your number. It's used as typed; extra lambs aren't added to it.`
              : `${c.final}, the lambs on the cut sheet's sets. Extra lambs need to be in the sets.`}
          </li>
        )}
        {leTrim.ordered.lb > 0 && (
          <li>
            <b>Le Trim never sets the count.</b> {fmt(leTrim.ordered.lb)} lb ordered, made from what&apos;s spare after the other
            orders ({fmt(Math.round(leTrim.spare.trimLb))} lb trim, {leTrim.spare.shoulders} shoulders, {leTrim.spare.legs} legs
            {leTrim.planned ? "; your saved plan is used in the balance" : ""}): approximately {fmt(Math.round(leTrim.need.trimLb))} lb
            trim, {leTrim.need.shoulders} shoulders and {leTrim.need.halfLegs} half legs
            {leTrim.need.shortLb > 0
              ? `, short approximately ${fmt(Math.round(leTrim.need.shortLb))} lb (approximately ${leTrim.need.extraLambs} extra average-size lambs).`
              : ", which covers it."}
          </li>
        )}
        {w.notCounted.length > 0 && (
          <li>
            <b>Not counted</b> (not from a lamb, or set not to count): {w.notCounted.map((x) => `${x.product} ${fmt(x.qty)}`).join(", ")}.
          </li>
        )}
      </ol>
    </details>
  );
}
