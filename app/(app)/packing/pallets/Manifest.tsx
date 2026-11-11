// The pallet shipping manifest (change request 10/26/26; one customer per
// page since 11/2/26), one component for every entry point: the manifest
// page (opened from Pallets, and from Print and download) draws it, and the
// CSV download (one row per box) uses the same boxes. Each customer gets its
// own Letter page: a row per box by product, a subtotal under any product
// with 2 or more boxes, the customer's total, Received by / Date. Printing
// all for a ship date puts each distributor's cross dock sheet first, then
// its pallets' customer pages (./Paperwork.tsx). A box ID used twice in the
// week is flagged on each customer it touches.

import type { PackingBundle } from "@/components/offline/usePackingBundle";
import {
  boxIdOf,
  boxIdShown,
  buildManifest,
  duplicateBoxIds,
  manifestTable,
  netWeight,
  type DuplicateBox,
  type Manifest,
} from "@/lib/calc/manifest";
import { crossDockGroups, customerManifests, looseBoxWarnings, palletCountWarnings } from "@/lib/calc/paperwork";
import { weekBoxes, weekPallets, weekPoints } from "@/lib/paperworkData";
import { CustomerPages, PalletCover, type PaperworkContext } from "./Paperwork";
import { invFileName, invLabel } from "@/lib/weekInv";
import { weekName } from "@/lib/dates";
import type { PalletRow } from "@/lib/db/scanning";
import { boxName } from "@/lib/calc/packTogether";

export type PalletManifest = {
  pallet: PalletRow;
  ship: string;
  ofN: string;
  manifest: Manifest;
};

/** A shipment's name: the distributor, or the customer shipping direct. */
export function shipName(data: PackingBundle, key: string): string {
  const [kind, id] = key.split(":");
  if (kind === "point") return data.packing.points.get(id) ?? "Distributor";
  return (
    data.packing.orders.find((o) => o.customerId === id)?.labelCustomer ??
    "A customer"
  );
}

/** The manifests for these pallets (all of the week's when none are given), from the scanned boxes on each. */
export function palletManifests(
  data: PackingBundle,
  palletIds?: string[],
): PalletManifest[] {
  const p = data.packing;
  const boxes = [
    ...p.orders.flatMap((o) =>
      o.weights.map((w) => ({ w, customer: o.labelCustomer, lines: o.lines as Record<string, number> | null })),
    ),
    ...p.unassigned.map((w) => ({ w, customer: "Unassigned", lines: null as Record<string, number> | null })),
  ];
  const pallets = palletIds?.length
    ? data.pallets.filter((x) => palletIds.includes(x.id))
    : data.pallets;
  return pallets.map((pallet) => {
    const same = data.pallets.filter((x) =>
      x.shipKeys.some((k) => pallet.shipKeys.includes(k)),
    );
    return {
      pallet,
      ship: pallet.shipKeys.map((k) => shipName(data, k)).join(", "),
      ofN:
        same.length > 1 ? `${same.indexOf(pallet) + 1} of ${same.length}` : "",
      manifest: buildManifest(
        boxes
          .filter(({ w }) => w.pallet_id === pallet.id)
          .map(({ w, customer, lines }) => ({
            id: w.id,
            customer,
            product: boxName(w.product_id, p.products, lines),
            boxId: boxIdShown(w),
            lot: w.lot ?? "",
            lb: netWeight(w.weight),
          })),
        p.orders.map((o) => o.labelCustomer),
      ),
    };
  });
}

/**
 * The week's boxes on no pallet: weights typed on Packing (the weigh panel or
 * Type in from paper) and unassigned boxes. They're on no pallet's manifest,
 * so every manifest lists them instead of dropping them silently (10/26/26).
 */
export function looseBoxes(data: PackingBundle): Manifest {
  const p = data.packing;
  const boxes = [
    ...p.orders.flatMap((o) =>
      o.weights.map((w) => ({ w, customer: o.labelCustomer, lines: o.lines as Record<string, number> | null })),
    ),
    ...p.unassigned.map((w) => ({ w, customer: "Unassigned", lines: null as Record<string, number> | null })),
  ];
  return buildManifest(
    boxes
      .filter(({ w }) => !w.pallet_id)
      .map(({ w, customer, lines }) => ({
        id: w.id,
        customer,
        product: boxName(w.product_id, p.products, lines),
        boxId: boxIdShown(w),
        lot: w.lot ?? "",
        lb: netWeight(w.weight),
      })),
    p.orders.map((o) => o.labelCustomer),
  );
}

/** Box IDs used more than once in the week, and where: "PCC #13 Edmonds · Racks · P2". */
export function weekDuplicates(data: PackingBundle): DuplicateBox[] {
  const p = data.packing;
  const tag = (id: string | null) => (id ? (data.pallets.find((x) => x.id === id)?.tag ?? "a pallet") : "no pallet");
  return duplicateBoxIds([
    ...p.orders.flatMap((o) => o.weights.map((w) => ({ boxId: boxIdOf(w), where: `${o.labelCustomer} · ${boxName(w.product_id, p.products, o.lines)} · ${tag(w.pallet_id)}` }))),
    ...p.unassigned.map((w) => ({ boxId: boxIdOf(w), where: `Unassigned · ${boxName(w.product_id, p.products)} · ${tag(w.pallet_id)}` })),
  ]);
}

/** The CSV for these manifests: pallet, customer, box ID, lot, product, net weight; the week's INV# on top. */
export const manifestsTable = (list: PalletManifest[], inv: string | null, week: string) => ({
  ...manifestTable(list.map((m) => ({ tag: m.pallet.tag, manifest: m.manifest }))),
  title: `${invLabel(inv)} · Pallet manifest · Packing ${weekName(week)}`,
});

/** "INV3001 Pallet Manifest 2026-10-26", or "INV3001 Pallet Manifest P3 2026-10-26" for one pallet. */
export const manifestFile = (inv: string | null, week: string, tag?: string) =>
  invFileName(inv, tag ? `Pallet Manifest ${tag}` : "Pallet Manifests", week);

/** "Data as of Mon Oct 26, 3:05 PM", and whether it's the copy saved on this phone (no signal). */
export type ManifestAsOf = { at: string | null; fromPhone: boolean };

/** Which pallets: one, or a ship date ("none": not set yet), or all of the week. */
export type PalletPick = { palletId?: string | null; date?: string | null };

/** The pallets the paperwork covers, grouped by distributor and ship date, and those with no distributor. */
export function pickPallets(data: PackingBundle, pick: PalletPick) {
  const pallets = weekPallets(data).filter((p) => !pick.palletId || p.id === pick.palletId);
  const { groups, blocked } = crossDockGroups(pallets, weekPoints(data));
  const onDate = (d: string | null) => !pick.date || (pick.date === "none" ? d == null : d === pick.date);
  return {
    groups: groups.filter((g) => onDate(g.shipDate)),
    blocked: blocked.filter((b) => onDate(b.pallet.shipDate)),
  };
}

/** The paperwork's shared details: company, INV#, week, ship from, contacts. */
export function paperworkContext(data: PackingBundle): PaperworkContext {
  const p = data.packing;
  return { company: p.company, inv: p.invNumber, week: p.week, shipFrom: p.shipFrom, contacts: p.contacts ?? [] };
}

/**
 * Warnings for the paperwork (Lucas, 11/2/26), on screen only: in a banner
 * above the preview, on Packing, and in the "Print anyway?" check. Never on a
 * printed page. A box ID used twice in the week, boxes with no weight on
 * these pallets, every box of the week on no pallet by customer and product,
 * each pallet's boxes against the stores planned onto it (11/10/26), and the
 * copy saved on this phone.
 */
export function paperworkWarnings(data: PackingBundle, pick: PalletPick = {}, opts: { asOf?: ManifestAsOf } = {}): string[] {
  const out: string[] = [];
  const { groups, blocked } = pickPallets(data, pick);
  const pallets = [...groups.flatMap((g) => g.pallets.map((r) => r.pallet)), ...blocked.map((b) => b.pallet)];
  const tags = pallets.map((p) => p.tag);
  const whole = !pick.palletId && !pick.date;
  for (const d of weekDuplicates(data))
    if (whole || d.where.some((w) => tags.some((t) => w.endsWith(` · ${t}`))))
      out.push(`Box ID ${d.boxId} is used more than once this week: ${d.where.join(" and ")}. Check the labels.`);
  for (const p of pallets)
    for (const b of p.boxes.filter((x) => x.lb == null))
      out.push(`A ${b.product} box for ${b.customer} on ${p.tag}${b.boxId ? ` (${b.boxId})` : ""} has no weight. Weigh it before it ships.`);
  // Every box of the week on no pallet, and each of these pallets against its stores (11/10/26).
  const boxes = weekBoxes(data);
  out.push(...looseBoxWarnings(boxes));
  const ids = new Set(pallets.map((p) => p.id));
  out.push(
    ...palletCountWarnings(
      boxes,
      data.pallets.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, tag: p.tag, customers: p.customers ?? [] })),
      data.pallets,
    ),
  );
  if (opts.asOf?.fromPhone)
    out.push("No signal: this is the copy saved on this phone. Boxes scanned on other phones since then aren't on it. Print again with signal.");
  return out;
}

/**
 * The manifests (Lucas, 11/2/26): only customer pages (cross dock sheets
 * print from their own option). Pallets in number order (P1, P2, ...), each
 * with a short cover page, then its customers by name. Boxes on no pallet
 * last (when `showLoose`). No warnings on the pages: see paperworkWarnings.
 */
export function ManifestSheets({ data, pick, showLoose = false }: { data: PackingBundle; pick: PalletPick; showLoose?: boolean }) {
  const ctx = paperworkContext(data);
  const { groups, blocked } = pickPallets(data, pick);
  // Every pallet with its distributor and "Plymouth 1 of 3" (none for a pallet with no distributor), by pallet number.
  const pallets = [
    ...groups.flatMap((g) => g.pallets.map((r) => ({ pallet: r.pallet, point: g.point, name: `${g.point.shortName} ${r.n} of ${r.of}` }))),
    ...blocked.map((b) => ({ pallet: b.pallet, point: null, name: "" })),
  ].sort((a, b) => a.pallet.tag.localeCompare(b.pallet.tag, undefined, { numeric: true, sensitivity: "base" }));
  const loose = weekBoxes(data).filter((b) => !b.palletId);
  // Customers in the week's packing order: customers with locations first (Lucas, 11/6/26).
  const order = data.packing.orders.map((o) => o.labelCustomer);

  return (
    <div className="pkmanifest">
      {pallets.map(({ pallet, point, name }) => {
        const customers = customerManifests(pallet.boxes, order);
        return (
          <div key={pallet.id}>
            <PalletCover tag={pallet.tag} palletName={name} point={point} customers={customers} shipDate={pallet.shipDate} ctx={ctx} />
            {customers.map((cm, i) => (
              <CustomerPages
                key={cm.customer}
                cm={cm}
                point={point}
                palletTag={pallet.tag}
                palletName={name}
                storeN={i + 1}
                storeOf={customers.length}
                shipDate={pallet.shipDate}
                ctx={ctx}
              />
            ))}
          </div>
        );
      })}
      {showLoose &&
        customerManifests(loose, order).map((cm, i, all) => (
          <CustomerPages
            key={`loose|${cm.customer}`}
            cm={cm}
            point={null}
            palletTag="No pallet"
            palletName=""
            storeN={i + 1}
            storeOf={all.length}
            shipDate={null}
            ctx={ctx}
          />
        ))}
    </div>
  );
}
