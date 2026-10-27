// The pallet shipping manifest (change request 10/26/26), one component for
// every entry point: the manifest page (opened from Pallets, and from Print
// and download) draws it, and the CSV download uses the same rows. Letter,
// portrait, the browser's print: one pallet per page, each customer's rows
// with column headings repeated if they run onto the next page.

import type { PackingBundle } from "@/components/offline/usePackingBundle";
import {
  boxIdOf,
  buildManifest,
  lbText,
  manifestTable,
  netWeight,
  type Manifest,
} from "@/lib/calc/manifest";
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

/** The CSV for these manifests: pallet, customer, box ID, lot, product, net weight. */
export const manifestsTable = (list: PalletManifest[]) =>
  manifestTable(list.map((m) => ({ tag: m.pallet.tag, manifest: m.manifest })));

/** "Data as of Mon Oct 26, 3:05 PM", and whether it's the copy saved on this phone (no signal). */
export type ManifestAsOf = { at: string | null; fromPhone: boolean };

export function ManifestSheets({
  data,
  list,
  loose,
  asOf,
  showLoose = false,
}: {
  data: PackingBundle;
  list: PalletManifest[];
  /** The week's boxes on no pallet (looseBoxes). */
  loose: Manifest;
  asOf: ManifestAsOf;
  /** Print them as their own page (Print all). */
  showLoose?: boolean;
}) {
  const { company, shipFrom, week } = data.packing;
  const asOfText = asOf.at
    ? new Date(asOf.at).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const notices = (
    <>
      {asOf.fromPhone && (
        <p className="mf-warn">
          ⚠ No signal: this is the copy saved on this phone
          {asOfText ? ` at ${asOfText}` : ""}. Boxes scanned on other phones
          since then aren&apos;t on it. Print again with signal before the
          pallet ships.
        </p>
      )}
      {loose.boxes > 0 && (
        <p className="mf-warn">
          ⚠ {loose.boxes} box
          {loose.boxes === 1 ? " this week is" : "es this week are"} on no
          pallet, so not on any manifest:{" "}
          {loose.groups
            .flatMap((g) =>
              g.rows.map((r) => `${g.customer} ${r.product} ${lbText(r.lb)}`),
            )
            .join("; ")}
          . Put {loose.boxes === 1 ? "it" : "them"} on a pallet (scan again,
          then Wrong pallet) before shipping.
        </p>
      )}
    </>
  );
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
              {shipFrom ? (
                <div className="whitespace-pre-line">{shipFrom}</div>
              ) : (
                <div className="mf-lines" />
              )}
            </div>
            <div>
              <b>Ship to</b>
              <div className="mf-ship">{ship}</div>
            </div>
          </div>
          {notices}
          {m.missing > 0 && (
            <p className="mf-warn">
              ⚠ {m.missing} box{m.missing === 1 ? " has" : "es have"} no weight
              (MISSING below). Weigh {m.missing === 1 ? "it" : "them"} before
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
                    <td className="num">
                      {r.lb == null ? <b>MISSING</b> : lbText(r.lb)}
                    </td>
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
          <p className="mf-foot">
            Copy 1 ships with pallet / Copy 2 retained.
            {asOfText ? ` Data as of ${asOfText}.` : ""}
          </p>
        </section>
      ))}
      {showLoose && loose.boxes > 0 && (
        <section className="mf-pallet">
          <div className="mf-head">
            <div className="mf-tag">—</div>
            <div className="flex-1">
              <div className="mf-co">{company}</div>
              <div>Boxes on no pallet · {weekName(week)}</div>
            </div>
          </div>
          <p className="mf-warn">
            These boxes are packed but on no pallet, so they&apos;re not on any
            manifest above. Put each on its pallet before shipping.
          </p>
          {loose.groups.map((g) => (
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
                    <td className="num">
                      {r.lb == null ? <b>MISSING</b> : lbText(r.lb)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
          <div className="mf-total">
            <span>
              On no pallet: {loose.boxes} box{loose.boxes === 1 ? "" : "es"}
            </span>
            <span>{lbText(loose.lb)}</span>
          </div>
        </section>
      )}
    </div>
  );
}
