"use client";

// Plan pallets for the week (Lucas, 10/26/26): which stores go on which
// pallet. A PCC shipment fills several pallets, each with its own stores, and
// the groups are often the same each week, so a week can start from last
// week's. Chris (at Mohawk) or Kathy sets it here; Scan boxes then sends each
// store's boxes to its pallet, still one tap to confirm. Saved on the phone
// first, like the rest of Packing.

import { useState } from "react";
import { getDb } from "@/components/data/db";
import { useOutbox } from "@/components/offline/OutboxProvider";
import type { PackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import { nextTag } from "@/lib/calc/routing";
import { addDays, weekName } from "@/lib/dates";
import { loadPallets } from "@/lib/db/scanning";

/** "point:<id>" or "customer:<id>" as the ship-to for start_pallet. */
const shipTo = (key: string) => {
  const [kind, id] = key.split(":");
  return kind === "point" ? { ship_to_customer_id: null, ship_to_point_id: id } : { ship_to_customer_id: id, ship_to_point_id: null };
};

export default function PlanPallets({ week, data, canPlan }: { week: string; data: PackingBundle; canPlan: boolean }) {
  const toast = useToast();
  const { enqueue } = useOutbox();
  const [tags, setTags] = useState<Record<string, string>>({});
  const [copying, setCopying] = useState(false);
  const p = data.packing;

  // The week's shipments, from the orders: a distributor's stores together; direct customers on their own.
  const shipments = new Map<string, { name: string; orders: typeof p.orders }>();
  for (const o of p.orders) {
    const s = shipments.get(o.shipKey) ?? { name: o.group ?? o.labelCustomer, orders: [] };
    s.orders.push(o);
    shipments.set(o.shipKey, s);
  }
  const list = [...shipments.entries()].sort(
    ([a, x], [b, y]) => Number(b.startsWith("point:")) - Number(a.startsWith("point:")) || x.name.localeCompare(y.name),
  );
  const live = data.pallets.filter((x) => x.status !== "shipped");
  const palletsFor = (key: string) => live.filter((x) => x.shipKeys.includes(key));

  const save = (a: Parameters<typeof enqueue>[0]) => enqueue(a).catch(() => toast("Couldn't save on this phone. Try again."));

  async function addPallet(key: string) {
    const tag = (tags[key] ?? "").trim().toUpperCase() || nextTag(data.pallets);
    if (data.pallets.some((x) => x.tag.trim().toUpperCase() === tag)) return toast(`${tag} is already used this week. Use a different tag.`);
    await save({ type: "pallet-start", id: crypto.randomUUID(), week_id: week, tag, ...shipTo(key), status: "planned", at: new Date().toISOString() });
    setTags((t) => ({ ...t, [key]: "" }));
  }

  /** Last week's pallets, tags and stores, for the stores ordering this week. */
  async function copyLastWeek() {
    setCopying(true);
    try {
      const prev = await loadPallets(getDb(), addDays(week, -7));
      const ordering = new Set(p.orders.map((o) => o.customerId));
      let made = 0;
      for (const old of prev) {
        const key = old.shipKeys[0];
        if (!key) continue;
        const stores = old.customers.filter((c) => ordering.has(c));
        if (!stores.length && !key.startsWith("point:")) continue;
        const id = crypto.randomUUID();
        await enqueue({ type: "pallet-start", id, week_id: week, tag: old.tag, ...shipTo(key), status: "planned", at: new Date().toISOString() });
        for (const c of stores) await enqueue({ type: "pallet-customer", week_id: week, pallet_id: id, customer_id: c, on: true });
        made++;
      }
      toast(made ? `${made} pallet${made === 1 ? "" : "s"} copied from ${weekName(addDays(week, -7))}` : "Last week has no pallets to copy.");
    } catch {
      toast("Couldn't load last week. This needs signal.");
    }
    setCopying(false);
  }

  if (!p.orders.length) return null;
  return (
    <section className="panel mt-3">
      <h3>Plan pallets</h3>
      <p className="small muted mt-1">
        Choose which pallet each store goes on. Scan boxes then sends each store&apos;s boxes there. You can still choose a
        different pallet when you scan.
      </p>
      {canPlan && !data.pallets.length && (
        <button type="button" className="btn mt-1" disabled={copying} onClick={() => void copyLastWeek()}>
          {copying ? "Copying..." : "Start from last week's pallets"}
        </button>
      )}

      {list.map(([key, s]) => {
        const pallets = palletsFor(key);
        return (
          <div key={key} className="mt-4">
            <h4 className="m-0 text-[1.1rem]">
              {s.name}
              <span className="small muted font-normal">
                {" "}
                · {pallets.length ? pallets.map((x) => x.tag).join(", ") : "no pallets yet"}
              </span>
            </h4>
            {canPlan && (
              <form
                className="mt-1 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addPallet(key);
                }}
              >
                <input
                  className="field num w-24!"
                  aria-label={`Tag for a new pallet for ${s.name}`}
                  placeholder={nextTag(data.pallets)}
                  value={tags[key] ?? ""}
                  onChange={(e) => setTags((t) => ({ ...t, [key]: e.target.value.toUpperCase().slice(0, 12) }))}
                />
                <button type="submit" className="btn ghost">
                  Add pallet
                </button>
              </form>
            )}
            {pallets.length > 0 && (
              <table className="simple mt-2">
                <tbody>
                  {s.orders.map((o) => {
                    const on = pallets.find((x) => x.customers.includes(o.customerId));
                    return (
                      <tr key={o.id}>
                        <td>{o.labelLocation || o.labelCustomer}</td>
                        <td>
                          <select
                            className="field w-auto!"
                            aria-label={`Pallet for ${o.labelCustomer}`}
                            value={on?.id ?? ""}
                            disabled={!canPlan}
                            onChange={(e) =>
                              void save({
                                type: "pallet-customer",
                                week_id: week,
                                pallet_id: e.target.value || on?.id || "",
                                customer_id: o.customerId,
                                on: !!e.target.value,
                              })
                            }
                          >
                            <option value="">Not planned</option>
                            {pallets.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.tag}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}
