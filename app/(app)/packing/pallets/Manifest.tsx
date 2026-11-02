// The pallet shipping manifest (change request 10/26/26), one component for
// every entry point: the manifest page (opened from Pallets, and from Print
// and download) draws it, and the CSV download uses the same rows. Letter,
// portrait, the browser's print: one pallet per page, each customer's rows
// with column headings repeated if they run onto the next page. Since
// 11/2/26 each customer's boxes are one row per product (every box ID with
// its net weight, the product's total), the lot once in the header when the
// whole pallet shares one, and a warning when a box ID is used twice in the
// week. The CSV is still one row per box.

import type { PackingBundle } from "@/components/offline/usePackingBundle";
import {
  boxEntry,
  boxIdOf,
  buildManifest,
  duplicateBoxIds,
  lbText,
  manifestTable,
  netWeight,
  oneLot,
  productRows,
  productTotalText,
  type DuplicateBox,
  type Manifest,
  type ManifestGroup,
} from "@/lib/calc/manifest";
import PrintHeader from "@/components/PrintHeader";
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

/** One customer's boxes: a row per product, its box count, every box ID with its net weight, the product's total; the store total last. */
function GroupTable({ g, withLot }: { g: ManifestGroup; withLot: boolean }) {
  return (
    <table className="mf-table">
      <thead>
        <tr>
          <th colSpan={4} className="mf-group">
            {g.customer}
          </th>
        </tr>
        <tr>
          <th>Product</th>
          <th className="num">Qty</th>
          <th>Box IDs (net lb)</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {productRows(g.rows).map((r) => (
          <tr key={r.product}>
            <td>{r.product}</td>
            <td className="num">{r.boxes.length}</td>
            <td className="mf-ids">
              {r.boxes.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ", "}
                  {b.lb == null ? <b>{boxEntry(b, withLot)}</b> : boxEntry(b, withLot)}
                </span>
              ))}
            </td>
            <td className="num">{r.missing ? <b>{productTotalText(r)}</b> : productTotalText(r)}</td>
          </tr>
        ))}
        <tr className="mf-sub">
          <td>{g.customer} total</td>
          <td className="num">{g.boxes}</td>
          <td />
          <td className="num">{lbText(g.lb)}</td>
        </tr>
      </tbody>
    </table>
  );
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
  const dups = weekDuplicates(data);
  const { company, shipFrom, week, invNumber } = data.packing;
  const header = (i: number) => (
    <PrintHeader inv={invNumber} title="Pallet manifest" when={`Packing ${weekName(week)}`} footer={i === 0} />
  );
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
      {dups.length > 0 && (
        <p className="mf-warn">
          ⚠ Box ID{dups.length === 1 ? "" : "s"} used more than once this week:{" "}
          {dups.map((d, i) => (
            <span key={d.boxId}>
              {i > 0 && "; "}
              {d.boxId} ({d.where.join(" and ")})
            </span>
          ))}
          . Check the labels before this pallet ships.
        </p>
      )}
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
      {list.map(({ pallet, ship, ofN, manifest: m }, i) => (
        <section key={pallet.id} className="mf-pallet">
          {header(i)}
          <div className="mf-head">
            <div className="mf-tag">{pallet.tag}</div>
            <div className="flex-1">
              <div className="mf-co">{company}</div>
              <div>
                Pallet {pallet.tag}
                {ofN ? ` · ${ofN}` : ""} · {weekName(week)}
              </div>
              {oneLot(m) && <div className="mf-lot">Lot {oneLot(m)}</div>}
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
            <GroupTable key={g.customer} g={g} withLot={!oneLot(m)} />
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
          {header(list.length)}
          <div className="mf-head">
            <div className="mf-tag">—</div>
            <div className="flex-1">
              <div className="mf-co">{company}</div>
              <div>Boxes on no pallet · {weekName(week)}</div>
              {oneLot(loose) && <div className="mf-lot">Lot {oneLot(loose)}</div>}
            </div>
          </div>
          <p className="mf-warn">
            These boxes are packed but on no pallet, so they&apos;re not on any
            manifest above. Put each on its pallet before shipping.
          </p>
          {loose.groups.map((g) => (
            <GroupTable key={g.customer} g={g} withLot={!oneLot(loose)} />
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
