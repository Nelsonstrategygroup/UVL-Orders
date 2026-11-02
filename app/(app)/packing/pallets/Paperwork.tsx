// The pallet paperwork (Lucas, 11/2/26), drawn from lib/calc/paperwork.ts:
// - CrossDockSheet: one Letter page per distributor per ship date, a band in
//   the distributor's color with its name large in white and its short code,
//   the pallets (Plymouth 1, 2, 3) with cases and weight, big totals, and
//   Received by / Date. Dark colors only, so it reads in black and white.
// - PalletLabel: Letter landscape for the outside of a pallet: the carrier
//   "to" the distributor, the stores on it, "Pallet 1 of 3" and the cases,
//   the short code in a corner.
// - CustomerPages: the manifest, one customer per page: a row per box by
//   product, a shaded subtotal under any product with 2 or more boxes, the
//   customer's total, Received by / Date. A long customer carries on to a
//   second page with the header repeated ("page 2 of 2").
// Counts and weights all come from the scanned box records.

import type { CSSProperties } from "react";
import type { DuplicateBox } from "@/lib/calc/manifest";
import { lbWords, manifestPages, type CrossDockGroup, type CrossDockPallet, type CustomerManifest, type PwDistributor } from "@/lib/calc/paperwork";
import type { Contact } from "@/lib/db/packing";
import { longDate, shipDay, weekName } from "@/lib/dates";
import { invLabel } from "@/lib/weekInv";

export type PaperworkContext = {
  company: string;
  inv: string | null;
  week: string;
  shipFrom: string;
  contacts: Contact[];
};

const contactLine = (c: Contact) => [c.name, c.phone, c.email].filter(Boolean).join(" · ");
/** "Monday, Nov 2", or a line to write the date on. */
const colorVars = (color: string) => ({ "--pw-color": color }) as CSSProperties;

/** Box ID warnings that touch these customers or pallets. */
function DupWarning({ dups }: { dups: DuplicateBox[] }) {
  if (!dups.length) return null;
  return (
    <p className="mf-warn">
      ⚠ Box ID{dups.length === 1 ? "" : "s"} used more than once this week:{" "}
      {dups.map((d, i) => (
        <span key={d.boxId}>
          {i > 0 && "; "}
          {d.boxId} ({d.where.join(" and ")})
        </span>
      ))}
      . Check the labels before this ships.
    </p>
  );
}

function MissingWarning({ n }: { n: number }) {
  if (!n) return null;
  return (
    <p className="mf-warn">
      ⚠ {n} box{n === 1 ? " has" : "es have"} no weight (MISSING). Weigh {n === 1 ? "it" : "them"} before this ships.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Cross dock sheet
// ---------------------------------------------------------------------------

export function CrossDockSheet({ group, ctx, dups }: { group: CrossDockGroup; ctx: PaperworkContext; dups: DuplicateBox[] }) {
  const p = group.point;
  return (
    <section className="pw-page cd" style={colorVars(p.color)}>
      <div className="cd-band">
        <span className="cd-name">{p.name}</span>
        {p.code && <span className="cd-code">{p.code}</span>}
      </div>
      <div className="cd-meta">
        <div className="cd-meta-left">
          <div>
            <b>Carrier:</b> {p.carrier || <span className="pw-line" />}
          </div>
          <div>
            <b>Cross dock:</b> {p.crossDock || <span className="pw-line" />}
          </div>
          <div>
            <b>Ship date:</b> {longDate(group.shipDate ?? shipDay(ctx.week))}
          </div>
        </div>
        <div className="cd-inv">{invLabel(ctx.inv)}</div>
      </div>
      <div className="cd-from">
        <b>{ctx.company}</b>
        {ctx.contacts.map((c, i) => (
          <span key={i}>
            {" "}
            · {i === 0 ? "Contact" : "Also"}: {contactLine(c)}
          </span>
        ))}
        <span> · Packing {weekName(ctx.week)}</span>
      </div>
      <MissingWarning n={group.missing} />
      <DupWarning dups={dups} />
      <table className="cd-table">
        <thead>
          <tr>
            <th>Pallet</th>
            <th>No.</th>
            <th className="num">Cases</th>
            <th className="num">Weight (lb)</th>
            <th className="cd-notes">Notes</th>
          </tr>
        </thead>
        <tbody>
          {group.pallets.map((r) => (
            <tr key={r.pallet.id}>
              <td>
                <b>{r.name}</b>
                <div className="cd-custs">{r.customers}</div>
              </td>
              <td>{r.pallet.tag}</td>
              <td className="num">{r.cases}</td>
              <td className="num">
                {lbWords(r.lb).replace(" lb", "")}
                {r.missing > 0 && <div className="cd-custs">+ {r.missing} MISSING</div>}
              </td>
              <td className="cd-notes">
                <span className="pw-line wide" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cd-totals">
        <div>
          <span>Pallets</span>
          <b>{group.pallets.length}</b>
        </div>
        <div>
          <span>Cases</span>
          <b>{group.cases}</b>
        </div>
        <div>
          <span>Weight</span>
          <b>{lbWords(group.lb)}</b>
        </div>
      </div>
      <div className="cd-bottom">
        <div className="cd-bar">{p.code || p.shortName}</div>
        <div className="mf-sign">
          <span>
            Received by <span className="mf-line wide" />
          </span>
          <span>
            Date <span className="mf-line" />
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pallet label
// ---------------------------------------------------------------------------

export function PalletLabel({ row, group, ctx }: { row: CrossDockPallet; group: CrossDockGroup; ctx: PaperworkContext }) {
  const p = group.point;
  const contact = ctx.contacts[0];
  return (
    <section className="pw-page plab" style={colorVars(p.color)}>
      <div className="plab-top">
        <b>{ctx.company}</b>
        <span>
          Cross dock {longDate(group.shipDate ?? shipDay(ctx.week))} · {invLabel(ctx.inv)}
        </span>
      </div>
      <div className="plab-center">
        {p.code && <div className="plab-code">{p.code}</div>}
        {p.carrier && <div className="plab-carrier">{p.carrier}</div>}
        {p.carrier && <div className="plab-to">to</div>}
        <div className="plab-dist">{p.name}</div>
        <div className="plab-custs">{row.customers}</div>
      </div>
      <div className="plab-boxes">
        <div>
          <span>Pallet</span>
          <b>
            {row.n} of {row.of}
          </b>
        </div>
        <div>
          <span>Cases</span>
          <b>{row.cases}</b>
        </div>
      </div>
      <div className="plab-foot">
        <span>
          {row.pallet.tag} · {lbWords(row.lb)}
          {row.missing > 0 ? ` + ${row.missing} MISSING` : ""}
        </span>
        {contact && <span>{[contact.name, contact.phone].filter(Boolean).join(" · ")}</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The manifest: a cover page per pallet, then one page per customer
// ---------------------------------------------------------------------------

/** Rows on a customer page: fixed heights (in), so a long customer splits into pages the app can number. */
export const CM = { rowH: 0.24, pageH: 10.2, head: 2.3, colHead: 0.3, pageOf: 0.25, foot: 1.35, warn: 0.5 } as const;

/**
 * A pallet's cover page, before its customers (Lucas, 11/2/26): the pallet
 * large in the distributor's color with its short code, each customer's boxes
 * and weight, and the pallet's total.
 */
export function PalletCover({
  tag,
  palletName,
  point,
  customers,
  shipDate,
  ctx,
}: {
  tag: string;
  /** "Plymouth 1 of 3", or "" when the pallet has no distributor. */
  palletName: string;
  point: PwDistributor | null;
  customers: CustomerManifest[];
  shipDate: string | null;
  ctx: PaperworkContext;
}) {
  const boxes = customers.reduce((s, c) => s + c.boxes, 0);
  const lb = Math.round(customers.reduce((s, c) => s + c.lb, 0) * 100) / 100;
  const missing = customers.reduce((s, c) => s + c.missing, 0);
  return (
    <section className="pw-page cmc" style={colorVars(point?.color ?? "#333333")}>
      <div className="cd-band">
        <span className="cd-name">
          {tag}
          {palletName ? ` · ${palletName}` : ""}
        </span>
        {point?.code && <span className="cd-code">{point.code}</span>}
      </div>
      <div className="cd-meta">
        <div className="cd-meta-left">
          <div>
            <b>{ctx.company}</b> · Pallet manifest
          </div>
          {point && (
            <div>
              <b>Via:</b> {point.name}
              {point.carrier ? ` · Carrier: ${point.carrier}` : ""}
            </div>
          )}
          <div>
            <b>Packing</b> {weekName(ctx.week)} · <b>Ship date</b> {longDate(shipDate ?? shipDay(ctx.week))}
          </div>
        </div>
        <div className="cd-inv">{invLabel(ctx.inv)}</div>
      </div>
      <MissingWarning n={missing} />
      <table className="cmc-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th className="num">Boxes</th>
            <th className="num">Net weight</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.customer}>
              <td>{c.customer}</td>
              <td className="num">{c.boxes}</td>
              <td className="num">
                {lbWords(c.lb)}
                {c.missing ? ` + ${c.missing} MISSING` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mf-total">
        <span>
          {tag}: {customers.length} customer{customers.length === 1 ? "" : "s"}, {boxes} box{boxes === 1 ? "" : "es"}
        </span>
        <span>{lbWords(lb)}</span>
      </div>
    </section>
  );
}

/** One customer's pages. */
export function CustomerPages({
  cm,
  point,
  palletTag,
  palletName,
  storeN,
  storeOf,
  shipDate,
  ctx,
  dups,
  extraWarnings = 0,
  notices,
}: {
  cm: CustomerManifest;
  point: PwDistributor | null;
  palletTag: string;
  /** "Plymouth 1 of 3", or "" when the pallet has no distributor. */
  palletName: string;
  /** "Store 2 of 5 on P1". */
  storeN: number;
  storeOf: number;
  shipDate: string | null;
  ctx: PaperworkContext;
  dups: DuplicateBox[];
  /** Notices drawn above the table on the first page (no signal, boxes on no pallet): counted for the page size. */
  extraWarnings?: number;
  notices?: React.ReactNode;
}) {
  const warns = (cm.missing ? 1 : 0) + (dups.length ? 1 : 0) + extraWarnings;
  const room = CM.pageH - CM.head - (ctx.shipFrom ? 0.6 : 0) - CM.colHead - CM.pageOf - warns * CM.warn;
  const pages = manifestPages(cm.rows, Math.floor(room / CM.rowH), Math.floor((room - CM.foot) / CM.rowH));
  return (
    <>
      {pages.map((rows, i) => {
        // One lot on this page: once in the header, no Lot column (Lucas, 11/2/26).
        const lots = new Set(rows.flatMap((r) => (r.kind === "box" ? [r.box.lot.trim()] : [])));
        const oneLot = lots.size === 1 ? [...lots][0] : "";
        const lotCol = !oneLot;
        return (
          <section key={i} className="pw-page cm" style={colorVars(point?.color ?? "#333333")}>
            <div className="cm-head">
              <div className="cm-head-left">
                <div className="cm-co">{ctx.company}</div>
                <div className="cm-cust">{cm.customer}</div>
                <div className="cm-pallet">
                  {point?.code && <span className="cm-code">{point.code}</span>}
                  <b>
                    {palletTag}
                    {palletName ? ` · ${palletName}` : ""}
                  </b>
                  <span className="cm-store">
                    Store {storeN} of {storeOf} on {palletTag}
                  </span>
                </div>
              </div>
              <div className="cm-inv">{invLabel(ctx.inv)}</div>
            </div>
            <div className="cm-dates">
              <span>
                <b>Packing</b> {weekName(ctx.week)}
              </span>
              <span>
                <b>Ship date</b> {longDate(shipDate ?? shipDay(ctx.week))}
              </span>
              {oneLot && (
                <span>
                  <b>Lot</b> {oneLot}
                </span>
              )}
            </div>
            <div className="cm-deliver">
              <div>
                <b>Deliver to:</b> <span className="mf-ship">{cm.customer}</span>
              </div>
              {point && (
                <div>
                  <b>Via:</b> {point.name}
                  {point.carrier ? ` · Carrier: ${point.carrier}` : ""}
                </div>
              )}
              {ctx.shipFrom && (
                <div className="cm-from">
                  <b>Ship from:</b> <span className="whitespace-pre-line">{ctx.shipFrom}</span>
                </div>
              )}
            </div>
            {i === 0 && (
              <>
                <MissingWarning n={cm.missing} />
                <DupWarning dups={dups} />
                {notices}
              </>
            )}
            {pages.length > 1 && (
              <p className="cm-pageof">
                {cm.customer}, page {i + 1} of {pages.length}
              </p>
            )}
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Box ID</th>
                  {lotCol && <th>Lot</th>}
                  <th>Product</th>
                  <th className="num">Net weight</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) =>
                  r.kind === "box" ? (
                    <tr key={r.box.id} style={{ height: `${CM.rowH}in` }}>
                      <td>{r.box.boxId}</td>
                      {lotCol && <td>{r.box.lot}</td>}
                      <td>{r.box.product}</td>
                      <td className="num">{r.box.lb == null ? <b>MISSING</b> : lbWords(r.box.lb)}</td>
                    </tr>
                  ) : (
                    // The product's subtotal: gray and small, lined up under its boxes; a thin rule above only.
                    <tr key={`sub:${r.product}`} className="cm-sub" style={{ height: `${CM.rowH}in` }}>
                      <td colSpan={lotCol ? 2 : 1} />
                      <td>
                        {r.product} · {r.boxes} boxes
                      </td>
                      <td className="num">
                        {lbWords(r.lb)}
                        {r.missing ? ` + ${r.missing} MISSING` : ""}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {i === pages.length - 1 && (
              <>
                <div className="mf-total">
                  <span>
                    {cm.customer}: {cm.boxes} box{cm.boxes === 1 ? "" : "es"}
                  </span>
                  <span>
                    {lbWords(cm.lb)}
                    {cm.missing ? ` + ${cm.missing} MISSING` : ""}
                  </span>
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
              </>
            )}
          </section>
        );
      })}
    </>
  );
}
