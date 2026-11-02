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
import { longDate, weekName } from "@/lib/dates";
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
const dateOrLine = (d: string | null) => (d ? longDate(d) : <span className="pw-line" />);
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
            <b>Ship date:</b> {dateOrLine(group.shipDate)}
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
          Cross dock {group.shipDate ? longDate(group.shipDate) : <span className="pw-line" />} · {invLabel(ctx.inv)}
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
// The manifest: one customer per page
// ---------------------------------------------------------------------------

/** Rows on a customer page: fixed heights (in), so a long customer splits into pages the app can number. */
export const CM = { rowH: 0.24, pageH: 10.2, head: 2.35, colHead: 0.3, pageOf: 0.25, foot: 1.35, warn: 0.5 } as const;

export function CustomerPages({
  cm,
  point,
  palletTag,
  palletName,
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
  shipDate: string | null;
  ctx: PaperworkContext;
  dups: DuplicateBox[];
  /** Notices drawn above the table on the first page (no signal, boxes on no pallet): counted for the page size. */
  extraWarnings?: number;
  notices?: React.ReactNode;
}) {
  const warns = (cm.missing ? 1 : 0) + (dups.length ? 1 : 0) + extraWarnings;
  const room = CM.pageH - CM.head - CM.colHead - CM.pageOf - warns * CM.warn;
  const pages = manifestPages(cm.rows, Math.floor(room / CM.rowH), Math.floor((room - CM.foot) / CM.rowH));
  return (
    <>
      {pages.map((rows, i) => (
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
              </div>
            </div>
            <div className="cm-inv">{invLabel(ctx.inv)}</div>
          </div>
          <div className="cm-dates">
            <span>
              <b>Packing</b> {weekName(ctx.week)}
            </span>
            <span>
              <b>Ship date</b> {dateOrLine(shipDate)}
            </span>
          </div>
          <div className="mf-addr">
            <div>
              <b>Ship from</b>
              {ctx.shipFrom ? <div className="whitespace-pre-line">{ctx.shipFrom}</div> : <div className="mf-lines" />}
            </div>
            <div>
              <b>Ship to</b>
              <div className="mf-ship">{point ? [point.name, point.crossDock].filter(Boolean).join(", ") : <span className="pw-line wide" />}</div>
            </div>
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
                <th>Lot</th>
                <th>Product</th>
                <th className="num">Net weight</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                r.kind === "box" ? (
                  <tr key={r.box.id} style={{ height: `${CM.rowH}in` }}>
                    <td>{r.box.boxId}</td>
                    <td>{r.box.lot}</td>
                    <td>{r.box.product}</td>
                    <td className="num">{r.box.lb == null ? <b>MISSING</b> : lbWords(r.box.lb)}</td>
                  </tr>
                ) : (
                  <tr key={`sub:${r.product}`} className="cm-sub" style={{ height: `${CM.rowH}in` }}>
                    <td colSpan={4}>
                      {r.product} · {r.boxes} boxes · {lbWords(r.lb)}
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
      ))}
    </>
  );
}
