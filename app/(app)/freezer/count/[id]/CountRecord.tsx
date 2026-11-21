"use client";

// A finished freezer count, kept as a record (11/19/26): when, who, what it
// covered, and what the review showed and what was done.

import Link from "next/link";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { formatWhen } from "@/lib/format";
import { niceDate } from "@/lib/dates";
import { loadCount } from "@/lib/db/freezer";

type Saved = {
  totals?: { app: number; counted: number; difference: number };
  products?: {
    product_id: string;
    app: number;
    counted: number;
    difference: number;
    matched: number;
    found: { item_id: string; serial: string | null; qty: number; weight_lb: number | null; added: boolean }[];
    held: { serial: string | null; customer: string }[];
    not_counted: { box_id: string; serial: string | null; qty: number; weight_lb: number | null; removed: string | null; note: string }[];
  }[];
};

const REMOVED: Record<string, string> = { sold: "Sold", used: "Used", discarded: "Discarded", not_found: "Not found", other: "Other" };

export default function CountRecord({ id }: { id: string }) {
  const { catalog } = useStaffData();
  const load = useCallback((d: SupabaseClient) => loadCount(d, id), [id]);
  const { data, error } = useLive(`freezer-count:${id}`, load, ["freezer_counts"]);
  if (error) return <p className="note bad">Couldn&apos;t load the count: {error}</p>;
  if (!data || !catalog) return <div className="empty">Loading...</div>;
  const c = data.count;
  if (!c) return <p className="note">That count isn&apos;t there.</p>;
  const name = (pid: string) => catalog.productById.get(pid)?.name ?? pid;
  const r = (c.results ?? {}) as Saved;
  const reconcile = c.kind === "reconcile";

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">
          {reconcile ? "Freezer count" : "Stock-in count"}, {niceDate(c.count_date)}
        </h2>
        <Link className="btn ghost" href="/freezer">
          Back to Freezer
        </Link>
      </div>
      <section className="panel">
        <p className="m-0">
          {c.status === "applied" ? `Applied ${c.applied_at ? formatWhen(c.applied_at) : ""}` : c.status === "discarded" ? "Thrown away: nothing changed." : "Still open."}
          {c.applied_anyway && " Applied while some scans hadn't uploaded."}
        </p>
        <p className="mt-1 mb-0">{c.product_ids?.length ? `Only: ${c.product_ids.map(name).join(", ")}.` : "Whole freezer."}</p>
        <p className="small muted mt-1 mb-0">{data.items.filter((i) => !i.voided).length} boxes and amounts counted.</p>
      </section>

      {reconcile && r.products && (
        <section className="panel mt-3">
          <table className="simple">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">In the app</th>
                <th className="num">Counted</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {r.products.map((p) => (
                <tr key={p.product_id}>
                  <td>{name(p.product_id)}</td>
                  <td className="num">{p.app}</td>
                  <td className="num">{p.counted}</td>
                  <td className={`num ${p.difference < 0 ? "negative" : ""}`}>{p.difference > 0 ? `+${p.difference}` : p.difference}</td>
                </tr>
              ))}
              {r.totals && (
                <tr>
                  <td>
                    <b>Total</b>
                  </td>
                  <td className="num">
                    <b>{r.totals.app}</b>
                  </td>
                  <td className="num">
                    <b>{r.totals.counted}</b>
                  </td>
                  <td className="num">
                    <b>{r.totals.difference > 0 ? `+${r.totals.difference}` : r.totals.difference}</b>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {(r.products ?? []).map((p) => (
        <section key={p.product_id} className="panel mt-3">
          <h3 className="mt-0">{name(p.product_id)}</h3>
          {reconcile && <p className="m-0">Matched: {p.matched}</p>}
          {p.found.length > 0 && (
            <>
              <p className="lbl">{reconcile ? "Found (not in the app)" : "Counted"}</p>
              <ul className="m-0">
                {p.found.map((f) => (
                  <li key={f.item_id}>
                    {f.qty}
                    {f.weight_lb ? ` · ${f.weight_lb} lb` : ""}
                    {f.serial ? ` · Serial ${f.serial}` : ""} · {f.added ? "Added" : "Not added"}
                  </li>
                ))}
              </ul>
            </>
          )}
          {p.held.length > 0 && <p className="small mt-2 mb-0">Held for customers: {p.held.map((h) => h.customer).join(", ")}</p>}
          {p.not_counted.length > 0 && (
            <>
              <p className="lbl">Not counted</p>
              <ul className="m-0">
                {p.not_counted.map((b) => (
                  <li key={b.box_id}>
                    {b.qty}
                    {b.weight_lb ? ` · ${b.weight_lb} lb` : ""}
                    {b.serial ? ` · Serial ${b.serial}` : ""} · {b.removed ? `Removed: ${REMOVED[b.removed] ?? b.removed}${b.note ? ` (${b.note})` : ""}` : "Left as is"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </>
  );
}
