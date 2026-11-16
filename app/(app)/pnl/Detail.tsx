"use client";

// "How this was calculated" for a P&L line (Lucas, 11/15/26): the formula in
// plain words with the real numbers, then each record it came from, with
// links to the invoice or weigh sheet. The tap-to-open sheet and the printed
// P&L detail both show it.

import Link from "next/link";
import Sheet from "@/components/Sheet";
import type { ExpenseCategory, WeekPnl } from "@/lib/calc/pnl";
import type { DetailItem, LineDetail } from "@/lib/calc/pnlDetail";
import { AdjustForm, FileButton, lineOptions } from "./Adjustments";

function Item({ it, depth }: { it: DetailItem; depth: number }) {
  return (
    <li className={`${depth ? "border-t border-line py-1" : "border-t border-line py-2"} ${it.voided ? "muted" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={depth ? "min-w-0 flex-1" : "min-w-0 flex-1 font-semibold"}>
          <span className={it.voided ? "line-through" : ""}>{it.label}</span>
          {it.tag && <span className="tag ml-2">{it.tag}</span>}
        </span>
        {it.amount && <span className={`num ${it.voided ? "line-through" : ""}`}>{it.amount}</span>}
      </div>
      {it.math?.map((m, i) => (
        <div key={i} className="small num">
          {m}
        </div>
      ))}
      {it.note && <div className="small muted">{it.note}</div>}
      {it.files && (
        <div className="small noprint flex flex-wrap gap-x-3">
          {it.files.map((f) => (
            <FileButton key={f.path} path={f.path} name={f.name} />
          ))}
        </div>
      )}
      {it.files && <div className="small print-only">Attached: {it.files.map((f) => f.name).join(", ")}</div>}
      {it.links && (
        <div className="small noprint flex flex-wrap gap-x-3">
          {it.links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
      {it.items && it.items.length > 0 && (
        <ul className="m-0 mt-1 list-none pl-4">
          {it.items.map((x, i) => (
            <Item key={i} it={x} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** One line's detail. `only`: show just this record (a tapped location or producer). */
export function DetailBlock({ d, only }: { d: LineDetail; only?: string }) {
  const items = only ? d.items.filter((i) => i.label === only) : d.items;
  return (
    <section className="pnl-detail">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="m-0 min-w-0 flex-1">{d.title}</h4>
        <b className="num">{d.amount ?? <span className="muted">Not worked out</span>}</b>
      </div>
      <div className="small mt-1">
        {d.how.map((h, i) => (
          <p key={i} className={i === d.how.length - 1 ? "num m-0 font-semibold" : "m-0"}>
            {h}
          </p>
        ))}
      </div>
      {items.length > 0 && (
        <ul className="m-0 mt-2 list-none p-0">
          {items.map((it, i) => (
            <Item key={i} it={it} depth={0} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Tap a P&L line: its detail in a sheet, and a way to adjust it. */
export function LineSheet({
  details,
  only,
  week,
  p,
  categories,
  onSaved,
  onClose,
}: {
  details: LineDetail[];
  only?: string;
  week: string;
  p: WeekPnl;
  categories: ExpenseCategory[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const options = lineOptions(p, categories);
  return (
    <Sheet title="How this was calculated" onClose={onClose}>
      <div className="grid gap-4">
        {details.map((d) => (
          <div key={d.key}>
            <DetailBlock d={d} only={only} />
            {d.lineKey && (
              <details className="mt-2">
                <summary className="copy">Adjust {d.lineKey === "category" ? "an expense category" : d.title.replace(/ \(projected\)$/, "")}</summary>
                <div className="mt-2">
                  <AdjustForm week={week} options={options} lineKey={d.lineKey} onSaved={onSaved} />
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
      <p className="small muted mt-3 mb-0">
        <Link href={`/pnl/detail?week=${week}`}>The whole week&apos;s P&amp;L detail, to print</Link>
      </p>
    </Sheet>
  );
}
