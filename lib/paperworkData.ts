// The week's packing data as the pallet paperwork needs it (lib/calc/paperwork.ts):
// every scanned or weighed box on a pallet with its store, distributor,
// product, box ID, lot and net weight. Counts and weights come only from
// these box records, so the cross dock sheet, pallet labels and manifests
// always agree (Lucas, 11/2/26).

import type { PackingBundle } from "@/components/offline/usePackingBundle";
import { boxIdOf, netWeight } from "./calc/manifest";
import type { PwBox, PwDistributor, PwPallet } from "./calc/paperwork";

/** Every box of the week with its store and distributor; pallet_id says which pallet it's on. */
export function weekBoxes(b: PackingBundle): (PwBox & { palletId: string | null })[] {
  const p = b.packing;
  const name = (pid: string) => p.products.get(pid)?.name ?? pid;
  return [
    ...p.orders.flatMap((o) =>
      o.weights.map((w) => ({
        id: w.id,
        palletId: w.pallet_id,
        customerId: o.customerId,
        customer: o.labelCustomer,
        labelName: o.labelName,
        labelLocation: o.labelLocation,
        pointId: o.shipsToPointId,
        product: name(w.product_id),
        boxId: boxIdOf(w) || (w.source === "weigh" ? "typed in" : ""),
        lot: w.lot ?? "",
        lb: netWeight(w.weight),
        at: w.at,
      })),
    ),
    ...p.unassigned.map((w) => ({
      id: w.id,
      palletId: w.pallet_id,
      customerId: null,
      customer: "Unassigned",
      labelName: "Unassigned",
      labelLocation: "",
      pointId: null,
      product: name(w.product_id),
      boxId: boxIdOf(w) || "typed in",
      lot: w.lot ?? "",
      lb: netWeight(w.weight),
      at: w.at,
    })),
  ];
}

/** The week's pallets with their boxes and the stores planned onto them. */
export function weekPallets(b: PackingBundle): PwPallet[] {
  const boxes = weekBoxes(b);
  const byCustomer = new Map(b.packing.orders.map((o) => [o.customerId, o]));
  return b.pallets.map((pl) => ({
    id: pl.id,
    tag: pl.tag,
    shipDate: pl.ship_date ?? null,
    boxes: boxes.filter((x) => x.palletId === pl.id),
    planned: pl.customers
      .map((id) => byCustomer.get(id))
      .filter((o) => !!o)
      .filter((o) => !boxes.some((x) => x.palletId === pl.id && x.customerId === o.customerId))
      .map((o) => ({ customer: o.labelCustomer, pointId: o.shipsToPointId })),
  }));
}

/** The distributors, by id. A copy saved on a phone before 11/2/26 has names only. */
export function weekPoints(b: PackingBundle): Map<string, PwDistributor> {
  const d = b.packing.distributors;
  if (d) return new Map([...d.entries()].map(([id, x]) => [id, x]));
  return new Map(
    [...b.packing.points.entries()].map(([id, name]) => [id, { id, name, shortName: name, code: "", carrier: "", crossDock: "", color: "#3B5E27" }]),
  );
}
