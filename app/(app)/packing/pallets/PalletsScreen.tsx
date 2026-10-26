"use client";

// Pallets for the week (scan-to-pallet routing, change request 10/26/26):
// each pallet's tag, its shipment, boxes, weight and status, and for a
// distributor's pallet the boxes by store. Printable as a pallet manifest:
// a distributor's pallets list the boxes grouped by store, so the
// distributor can break them down. Unassigned boxes (no open order needed
// them) are listed for Kathy to give to a customer.

import { useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { fmt } from "@/lib/calc/num";
import { palletTotals } from "@/lib/calc/routing";
import { weekName } from "@/lib/dates";
import { assignBox, type PackWeight } from "@/lib/db/packing";
import type { PalletRow } from "@/lib/db/scanning";

type Box = PackWeight & { customerId: string | null; customer: string };

const STATUS: Record<PalletRow["status"], string> = { planned: "Planned", open: "Open", full: "Full", shipped: "Shipped" };

export default function PalletsScreen() {
  const { week } = useWeek();
  const toast = useToast();
  const { enqueue, waiting } = useOutbox();
  const bundle = usePackingBundle(week);
  const canPack = useCan("packing").change;
  const canWeek = useCan("week").change;
  const [assigning, setAssigning] = useState<string | null>(null);
  const data = bundle.data;

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const p = data.packing;
  const all: Box[] = [
    ...p.orders.flatMap((o) => o.weights.map((w) => ({ ...w, customerId: o.customerId, customer: o.labelCustomer }))),
    ...p.unassigned.map((w) => ({ ...w, customerId: null, customer: "Unassigned" })),
  ];
  const name = (pid: string) => p.products.get(pid)?.name ?? pid;
  const shipName = (key: string) => {
    const [kind, id] = key.split(":");
    return kind === "point" ? (p.points.get(id) ?? "Distributor") : (p.orders.find((o) => o.customerId === id)?.labelCustomer ?? "A customer");
  };
  const isPoint = (pl: PalletRow) => pl.shipKeys.some((k) => k.startsWith("point:"));
  const onPallet = (id: string) => all.filter((b) => b.pallet_id === id);
  const noPallet = all.filter((b) => !b.pallet_id && b.customerId);
  const setStatus = (pl: PalletRow, status: PalletRow["status"]) =>
    void enqueue({ type: "pallet-status", id: pl.id, status }).catch(() => toast("Couldn't save on this phone. Try again."));

  return (
    <>
      <div className="screen-only">
        <WeekBar inv={p.invNumber} />
        <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto">Pallets</h2>
          <a href="/packing/scan" className="btn ghost">
            Scan boxes
          </a>
          <button type="button" className="btn" disabled={!data.pallets.length} onClick={() => window.print()}>
            Print manifest
          </button>
        </div>
        {waiting > 0 && (
          <p className="note warn">
            {waiting} {waiting === 1 ? "thing is" : "things are"} still waiting on this phone. The manifest may be missing boxes
            until they upload.
          </p>
        )}
        {!data.pallets.length && <div className="empty">No pallets yet. Pallets start from Scan boxes.</div>}

        {data.pallets.map((pl) => {
          const boxes = onPallet(pl.id);
          const t = palletTotals(boxes);
          return (
            <section key={pl.id} className="panel mt-3">
              <div className="flex flex-wrap items-center gap-3">
                <b className="text-[2.2rem] leading-none">{pl.tag}</b>
                <span className="flex-1 text-[1.1rem]">
                  {pl.shipKeys.map(shipName).join(", ")}
                  <span className="small muted">
                    {" "}
                    · {t.boxes} box{t.boxes === 1 ? "" : "es"} · {fmt(t.lb)} lb
                  </span>
                </span>
                <span className={`tag ${pl.status === "open" ? "even" : "plain"}`}>{STATUS[pl.status]}</span>
              </div>
              {isPoint(pl) && t.byCustomer.size > 0 && (
                <table className="simple mt-2">
                  <thead>
                    <tr>
                      <th>Store</th>
                      <th className="num">Boxes</th>
                      <th className="num">lb</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...t.byCustomer.entries()]
                      .map(([cid, v]) => ({ who: boxes.find((b) => b.customerId === cid)?.customer ?? "Unassigned", ...v }))
                      .sort((a, b) => a.who.localeCompare(b.who, undefined, { numeric: true }))
                      .map((r) => (
                        <tr key={r.who}>
                          <td>{r.who}</td>
                          <td className="num">{r.boxes}</td>
                          <td className="num">{fmt(Math.round(r.lb * 100) / 100)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
              {(canPack || canWeek) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pl.status !== "full" && (
                    <button type="button" className="btn ghost" onClick={() => setStatus(pl, "full")}>
                      Pallet full
                    </button>
                  )}
                  {pl.status !== "open" && (
                    <button type="button" className="btn ghost" onClick={() => setStatus(pl, "open")}>
                      Open again
                    </button>
                  )}
                  {pl.status !== "shipped" && (
                    <button type="button" className="btn ghost" onClick={() => setStatus(pl, "shipped")}>
                      Shipped
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {p.unassigned.length > 0 && (
          <section className="panel mt-4">
            <h3>Unassigned boxes</h3>
            <p className="small muted mt-1">No open order needed these. Choose who each one goes to, or leave it for now.</p>
            <ul className="m-0 mt-2 list-none p-0">
              {p.unassigned.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2">
                  <span className="flex-1">
                    {name(w.product_id)} · {fmt(w.weight)} lb · Lot {w.lot ?? "?"}
                    {w.case_no && <span className="small muted"> · case {w.case_no}</span>}
                  </span>
                  {(canPack || canWeek) && !w.id.startsWith("local:") && (
                    <select
                      className="field w-auto!"
                      value=""
                      disabled={assigning === w.id}
                      aria-label="Give this box to"
                      onChange={(e) => {
                        const orderId = e.target.value;
                        if (!orderId) return;
                        setAssigning(w.id);
                        void assignBox(getDb(), w.id, orderId).then((err) => {
                          setAssigning(null);
                          if (err) return toast(`Couldn't save: ${err}`);
                          toast("Box given to the customer");
                          bundle.refresh();
                        });
                      }}
                    >
                      <option value="">Give to...</option>
                      {p.orders.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.labelCustomer}
                          {o.lines[w.product_id] ? "" : " (not on their order)"}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {noPallet.length > 0 && (
          <p className="small muted mt-3">
            {noPallet.length} box{noPallet.length === 1 ? " was" : "es were"} weighed or typed in without a pallet.
          </p>
        )}
      </div>

      {/* The manifest: one pallet per page. A distributor's pallet lists its boxes by store. */}
      <div className="print-only pkmanifest">
        {data.pallets.map((pl) => {
          const boxes = onPallet(pl.id);
          const t = palletTotals(boxes);
          const groups = isPoint(pl)
            ? [...new Set(boxes.map((b) => b.customer))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            : [null];
          return (
            <section key={pl.id} className="mf-pallet">
              <div className="mf-head">
                <div className="mf-tag">{pl.tag}</div>
                <div>
                  <div className="mf-ship">Ship to: {pl.shipKeys.map(shipName).join(", ")}</div>
                  <div>
                    {weekName(week)} · {t.boxes} box{t.boxes === 1 ? "" : "es"} · {fmt(t.lb)} lb
                    {data.pallets.length > 1 ? ` · Pallet ${data.pallets.indexOf(pl) + 1} of ${data.pallets.length}` : ""}
                  </div>
                </div>
              </div>
              {waiting > 0 && <p className="mf-warn">Some scans had not uploaded when this was printed.</p>}
              {groups.map((g) => {
                const list = (g == null ? boxes : boxes.filter((b) => b.customer === g)).sort(
                  (a, b) => (a.label_no ?? 1e9) - (b.label_no ?? 1e9) || name(a.product_id).localeCompare(name(b.product_id)),
                );
                const gt = palletTotals(list);
                return (
                  <table key={g ?? "all"} className="mf-table">
                    {g != null && (
                      <caption>
                        {g} · {gt.boxes} box{gt.boxes === 1 ? "" : "es"} · {fmt(gt.lb)} lb
                      </caption>
                    )}
                    <thead>
                      <tr>
                        <th>Label</th>
                        {g == null && <th>Customer</th>}
                        <th>Product</th>
                        <th>lb</th>
                        <th>Lot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((b) => (
                        <tr key={b.id}>
                          <td>{b.label_no ?? ""}</td>
                          {g == null && <td>{b.customer}</td>}
                          <td>{name(b.product_id)}</td>
                          <td>{fmt(b.weight)}</td>
                          <td>{b.lot ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}
