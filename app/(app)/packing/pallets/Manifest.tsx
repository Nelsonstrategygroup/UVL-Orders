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
  buildManifest,
  duplicateBoxIds,
  manifestTable,
  netWeight,
  type DuplicateBox,
  type Manifest,
} from "@/lib/calc/manifest";
import { crossDockGroups, customerManifests } from "@/lib/calc/paperwork";
import { weekBoxes, weekPallets, weekPoints } from "@/lib/paperworkData";
import { CustomerPages, PalletCover, type PaperworkContext } from "./Paperwork";
import { invFileName, invLabel } from "@/lib/weekInv";
import { weekName } from "@/lib/dates";
import type { PalletRow } from "@/lib/db/scanning";

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
  const name = (pid: string) => p.products.get(pid)?.name ?? pid;
  const boxes = [
    ...p.orders.flatMap((o) =>
      o.weights.map((w) => ({ w, customer: o.labelCustomer })),
    ),
    ...p.unassigned.map((w) => ({ w, customer: "Unassigned" })),
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
          .map(({ w, customer }) => ({
            id: w.id,
            customer,
            product: name(w.product_id),
            boxId: boxIdOf(w),
            lot: w.lot ?? "",
            lb: netWeight(w.weight),
          })),
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
  const name = (pid: string) => p.products.get(pid)?.name ?? pid;
  const boxes = [
    ...p.orders.flatMap((o) =>
      o.weights.map((w) => ({ w, customer: o.labelCustomer })),
    ),
    ...p.unassigned.map((w) => ({ w, customer: "Unassigned" })),
  ];
  return buildManifest(
    boxes
      .filter(({ w }) => !w.pallet_id)
      .map(({ w, customer }) => ({
        id: w.id,
        customer,
        product: name(w.product_id),
        boxId: boxIdOf(w) || (w.source === "weigh" ? "typed in" : ""),
        lot: w.lot ?? "",
        lb: netWeight(w.weight),
      })),
  );
}

/** Box IDs used more than once in the week, and where: "PCC #13 Edmonds · Racks · P2". */
export function weekDuplicates(data: PackingBundle): DuplicateBox[] {
  const p = data.packing;
  const name = (pid: string) => p.products.get(pid)?.name ?? pid;
  const tag = (id: string | null) => (id ? (data.pallets.find((x) => x.id === id)?.tag ?? "a pallet") : "no pallet");
  return duplicateBoxIds([
    ...p.orders.flatMap((o) => o.weights.map((w) => ({ boxId: boxIdOf(w), where: `${o.labelCustomer} · ${name(w.product_id)} · ${tag(w.pallet_id)}` }))),
    ...p.unassigned.map((w) => ({ boxId: boxIdOf(w), where: `Unassigned · ${name(w.product_id)} · ${tag(w.pallet_id)}` })),
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

/** Duplicate box IDs that touch a customer ("PCC #13 Edmonds · ...") or any of these pallet tags ("... · P2"). */
const dupsForCustomer = (dups: DuplicateBox[], customer: string) => dups.filter((d) => d.where.some((w) => w.startsWith(`${customer} · `)));

/**
 * The manifests (Lucas, 11/2/26): only customer pages (cross dock sheets
 * print from their own option). Pallets in number order (P1, P2, ...), each
 * with a short cover page, then its customers by name. Boxes on no pallet
 * last (when `showLoose`).
 */
export function ManifestSheets({
  data,
  pick,
  asOf,
  showLoose = false,
}: {
  data: PackingBundle;
  pick: PalletPick;
  asOf: ManifestAsOf;
  showLoose?: boolean;
}) {
  const ctx = paperworkContext(data);
  const dups = weekDuplicates(data);
  const { groups, blocked } = pickPallets(data, pick);
  // Every pallet with its distributor and "Plymouth 1 of 3" (none for a pallet with no distributor), by pallet number.
  const pallets = [
    ...groups.flatMap((g) => g.pallets.map((r) => ({ pallet: r.pallet, point: g.point, name: `${g.point.shortName} ${r.n} of ${r.of}` }))),
    ...blocked.map((b) => ({ pallet: b.pallet, point: null, name: "" })),
  ].sort((a, b) => a.pallet.tag.localeCompare(b.pallet.tag, undefined, { numeric: true, sensitivity: "base" }));
  const loose = weekBoxes(data).filter((b) => !b.palletId);
  const asOfText = asOf.at
    ? new Date(asOf.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  // On every customer page, when it's the copy saved on this phone.
  const phone = asOf.fromPhone ? (
    <p className="mf-warn">
      ⚠ No signal: this is the copy saved on this phone{asOfText ? ` at ${asOfText}` : ""}. Boxes scanned on other phones since then aren&apos;t on it. Print
      again with signal before the pallet ships.
    </p>
  ) : null;
  const looseNote =
    loose.length > 0 ? (
      <p className="mf-warn">
        ⚠ {loose.length} box{loose.length === 1 ? " this week is" : "es this week are"} on no pallet, so not on any manifest. Put{" "}
        {loose.length === 1 ? "it" : "them"} on a pallet before shipping.
      </p>
    ) : null;

  return (
    <div className="pkmanifest">
      {pallets.map(({ pallet, point, name }) => {
        const customers = customerManifests(pallet.boxes);
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
                dups={dupsForCustomer(dups, cm.customer)}
                extraWarnings={phone ? 1 : 0}
                notices={phone}
              />
            ))}
          </div>
        );
      })}
      {showLoose &&
        customerManifests(loose).map((cm, i, all) => (
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
            dups={dupsForCustomer(dups, cm.customer)}
            extraWarnings={1}
            notices={looseNote}
          />
        ))}
    </div>
  );
}
