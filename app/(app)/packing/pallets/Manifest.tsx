// The pallet shipping manifest (change request 10/26/26), one component for
// every entry point: the manifest page (opened from Pallets, and from Print
// and download) draws it, and the CSV download uses the same rows. Letter,
// portrait, the browser's print: one pallet per page, each customer's rows
// with column headings repeated if they run onto the next page.

import type { PackingBundle } from "@/components/offline/usePackingBundle";
import { boxIdOf, buildManifest, lbText, manifestTable, netWeight, type Manifest } from "@/lib/calc/manifest";
import { weekName } from "@/lib/dates";
import type { PalletRow } from "@/lib/db/scanning";

export type PalletManifest = { pallet: PalletRow; ship: string; ofN: string; manifest: Manifest };

/** A shipment's name: the distributor, or the customer shipping direct. */
export function shipName(data: PackingBundle, key: string): string {
  const [kind, id] = key.split(":");
  if (kind === "point") return data.packing.points.get(id) ?? "Distributor";
  return data.packing.orders.find((o) => o.customerId === id)?.labelCustomer ?? "A customer";
}

/** The manifests for these pallets (all of the week's when none are given), from the scanned boxes on each. */
export function palletManifests(data: PackingBundle, palletIds?: string[]): PalletManifest[] {
  const p = data.packing;
  const name = (pid: string) => p.products.get(pid)?.name ?? pid;
  const boxes = [
    ...p.orders.flatMap((o) => o.weights.map((w) => ({ w, customer: o.labelCustomer }))),
    ...p.unassigned.map((w) => ({ w, customer: "Unassigned" })),
  ];
  const pallets = palletIds?.length ? data.pallets.filter((x) => palletIds.includes(x.id)) : data.pallets;
  return pallets.map((pallet) => {
    const same = data.pallets.filter((x) => x.shipKeys.some((k) => pallet.shipKeys.includes(k)));
    return {
      pallet,
      ship: pallet.shipKeys.map((k) => shipName(data, k)).join(", "),
      ofN: same.length > 1 ? `${same.indexOf(pallet) + 1} of ${same.length}` : "",
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

/** The CSV for these manifests: pallet, customer, box ID, lot, product, net weight. */
export const manifestsTable = (list: PalletManifest[]) => manifestTable(list.map((m) => ({ tag: m.pallet.tag, manifest: m.manifest })));

export function ManifestSheets({ data, list }: { data: PackingBundle; list: PalletManifest[] }) {
  const { company, shipFrom, week } = data.packing;
  return (
    <div className="pkmanifest">
      {list.map(({ pallet, ship, ofN, manifest: m }) => (
        <section key={pallet.id} className="mf-pallet">
          <div className="mf-head">
            <div className="mf-tag">{pallet.tag}</div>
            <div className="flex-1">
              <div className="mf-co">{company}</div>
              <div>
                Pallet {pallet.tag}
                {ofN ? ` · ${ofN}` : ""} · {weekName(week)}
              </div>
              <div>
                Ship date: <span className="mf-line" />
              </div>
            </div>
          </div>
          <div className="mf-addr">
            <div>
              <b>Ship from</b>
              {shipFrom ? <div className="whitespace-pre-line">{shipFrom}</div> : <div className="mf-lines" />}
            </div>
            <div>
              <b>Ship to</b>
              <div className="mf-ship">{ship}</div>
            </div>
          </div>
          {m.missing > 0 && (
            <p className="mf-warn">
              ⚠ {m.missing} box{m.missing === 1 ? " has" : "es have"} no weight (MISSING below). Weigh {m.missing === 1 ? "it" : "them"} before
              this pallet ships.
            </p>
          )}
          {!m.boxes && <p>No boxes scanned onto this pallet yet.</p>}
          {m.groups.map((g) => (
            <table key={g.customer} className="mf-table">
              <thead>
                <tr>
                  <th colSpan={4} className="mf-group">
                    {g.customer}
                  </th>
                </tr>
                <tr>
                  <th>Box ID</th>
                  <th>Lot</th>
                  <th>Product</th>
                  <th className="num">Net weight</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.boxId}</td>
                    <td>{r.lot}</td>
                    <td>{r.product}</td>
                    <td className="num">{r.lb == null ? <b>MISSING</b> : lbText(r.lb)}</td>
                  </tr>
                ))}
                <tr className="mf-sub">
                  <td colSpan={3}>
                    {g.customer}: {g.boxes} box{g.boxes === 1 ? "" : "es"}
                  </td>
                  <td className="num">{lbText(g.lb)}</td>
                </tr>
              </tbody>
            </table>
          ))}
          <div className="mf-total">
            <span>
              Pallet {pallet.tag}: {m.boxes} box{m.boxes === 1 ? "" : "es"}
            </span>
            <span>{lbText(m.lb)}</span>
          </div>
          <div className="mf-sign">
            <span>
              Received by <span className="mf-line wide" />
            </span>
            <span>
              Date <span className="mf-line" />
            </span>
          </div>
          <p className="mf-foot">Copy 1 ships with pallet / Copy 2 retained.</p>
        </section>
      ))}
    </div>
  );
}
