"use client";

// Setup (SPEC 5.10): a short menu of pages (products, boxes, parts per lamb,
// cut specs, sizes, pallet groups, GTINs, the processor, your records), each
// with how many items are left to check. Admin and office can look; only
// admins can change things.

import { deleteGtin, loadGtins, saveGtin } from "@/lib/db/scanning";
import BoxLimits from "./BoxLimits";
import Link from "next/link";
import { SETUP_SECTIONS, type SetupSlug } from "./sections";
import { boxCellsToCheck } from "@/lib/calc/boxes";
import { gtinCheckDigitOk } from "@/lib/scan/gs1";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { fmt, num } from "@/lib/calc/num";
import { drivesLambCount, needsChecking, partAmountRow } from "@/lib/calc/products";
import { unitWord } from "@/lib/calc/units";
import {
  addPart,
  addPoint,
  deleteCutSpec,
  loadPoints,
  setShipsTo,
  swapSpecSort,
  updatePoint,
  updateRow,
  updateSettings,
  saveProductPackBlanks,
} from "@/lib/db/save";
import { useLive } from "@/components/data/useLive";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { addCutSpec } from "@/lib/db/cutsheet";
import type { CatalogProduct } from "@/lib/db/types";
import EditProduct from "./EditProduct";

// What each cut spec type counts as on a cut set (SPEC 6.3), in plain words.
const USE_LABEL: Record<string, string> = {
  leg: "Leg",
  legshank: "Leg, hind shank stays on",
  shoulder: "Shoulder",
  rack: "Rack",
  loin: "Short loin",
  wholeloin: "Whole loin (rack and short loin)",
  saddle: "Loin saddle (both short loins)",
  fshank: "Front shank",
  hshank: "Hind shank",
  allshank: "Any shank (half front, half hind)",
  carcass: "Whole lamb",
  none: "Nothing to count (necks, bellies, bones)",
};

/** Setup: the menu when no section is given, else that section's page. */
export default function SetupScreen({ canEdit, section }: { canEdit: boolean; section?: SetupSlug }) {
  const { catalog, error, reloadCatalog } = useStaffData();
  const toast = useToast();
  const db = getDb();
  // A product being changed, "new" while adding one, or null.
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | "new" | null>(null);
  const [copying, setCopying] = useState(false);
  const [addingPart, setAddingPart] = useState(false);

  if (error) return <p className="note bad">Couldn&apos;t load Setup: {error}</p>;
  if (!catalog) return <div className="empty">Loading...</div>;

  async function done(err: string | null) {
    if (err) toast(`Couldn't save: ${err}`);
    else toast("Saved");
    await reloadCatalog();
  }

  const partName = (id: string) => catalog.parts.find((p) => p.id === id)?.name ?? id;
  const settings = catalog.settings;
  const specText = (id: string) => catalog.cutSpecs.find((s) => s.id === id)?.text ?? id;
  const onProducts = catalog.products.filter((p) => p.active);
  const offProducts = catalog.products.filter((p) => !p.active);
  const toCheck = needsChecking(catalog.products, catalog.parts);
  const open = (p: CatalogProduct, copy = false) => {
    setCopying(copy);
    setEditingProduct(p);
  };
  /** "2.5 lb per short loin" or "2 leg": a part use as Kathy says it. */
  const partUseText = (p: CatalogProduct, u: { part_id: string; qty: number }) => {
    const r = partAmountRow(u.qty);
    const part = partName(u.part_id).toLowerCase();
    const lb = catalog.parts.find((x) => x.id === u.part_id)?.unit === "lb";
    return r.mode === "per-part"
      ? `${fmt(r.amount)} ${unitWord(p.unit)} per ${lb ? "lb of " : ""}${part}`
      : `${fmt(r.amount)} ${lb ? "lb " : ""}${part}`;
  };

  const productTable = (products: CatalogProduct[]) => {
    return (
      <table className="simple">
        <thead>
          <tr>
            <th>Product</th>
            <th>Comes from</th>
            <th>Mohawk lines</th>
            <th>
              <span className="sr-only">Change or copy</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className={p.active ? "" : "bg-field"}>
              <td>
                <b>{p.name}</b>
                {!p.confirmed && p.active && <span className="tag extra ml-1">Check</span>}
                <br />
                <span className="small muted">
                  {[
                    p.group_name,
                    `by ${unitWord(p.unit, 1)}${p.alt_unit ? ` or ${unitWord(p.alt_unit, 1)}` : ""}`,
                    p.order_step !== 1 ? `steps of ${fmt(p.order_step)}` : "",
                    p.not_lamb ? "not a lamb product" : drivesLambCount(p, catalog!.parts) ? "" : "doesn't drive the lamb count",
                    p.fresh_only ? "fresh only" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </td>
              <td className="small">{p.uses.map((u) => partUseText(p, u)).join(" + ") || "none"}</td>
              <td className="small">{p.links.map((l) => specText(l.cut_spec_id)).join("; ") || "none"}</td>
              <td className="whitespace-nowrap text-right">
                {canEdit && (
                  <>
                    <button type="button" className="btn ghost" onClick={() => open(p)}>
                      Change
                    </button>{" "}
                    <button type="button" className="btn ghost" onClick={() => open(p, true)}>
                      Copy
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const productsToCheck = toCheck.filter((c) => c.kind === "product");
  const partsToCheck = toCheck.filter((c) => c.kind === "part").length;
  const boxesToCheck = boxCellsToCheck(catalog.boxes.limits, onProducts.map((p) => p.id));
  const processorName = settings?.processor_name || "Mohawk";
  const badge: Partial<Record<SetupSlug, number>> = {
    products: productsToCheck.length,
    parts: partsToCheck,
    boxes: boxesToCheck,
  };
  const titleOf = (slug: SetupSlug) =>
    slug === "instructions" ? `Instructions for ${processorName}` : SETUP_SECTIONS.find((s) => s.slug === slug)!.title;
  const editNote = canEdit ? (
    <p className="note small">Numbers highlighted in yellow are starting guesses. Correct them here and every calculation updates.</p>
  ) : (
    <p className="note small">Only an admin can change these. Ask Kathy or Eric if something looks wrong.</p>
  );

  // ----- The menu -----
  if (!section)
    return (
      <div className="max-w-[640px]">
        <h2 className="mb-2">Setup</h2>
        {editNote}
        <ul className="setupmenu">
          {SETUP_SECTIONS.filter((s) => !("adminOnly" in s && s.adminOnly) || canEdit).map((s) => {
            const n = badge[s.slug] ?? 0;
            return (
              <li key={s.slug}>
                <Link href={`/setup/${s.slug}`}>
                  <span className="min-w-0 flex-1">
                    <b>{titleOf(s.slug)}</b>
                    {n > 0 && <span className="tocheck"> · {n} to check</span>}
                    <span className="block text-[.85rem] text-ink-soft">{s.sub}</span>
                  </span>
                  <span aria-hidden="true" className="step-go">
                    &#8250;
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );

  const page = (body: React.ReactNode, wide = false, after?: React.ReactNode) => (
    <div className={wide ? "" : "max-w-[900px]"}>
      <Link href="/setup" className="copy">
        &larr; Setup
      </Link>
      <h2 className="mt-1 mb-2">{titleOf(section)}</h2>
      {editNote}
      {body}
      {after}
      {editingProduct && (
        <EditProduct
          key={`${editingProduct === "new" ? "new" : editingProduct.id}-${copying}`}
          product={editingProduct === "new" ? null : editingProduct}
          copy={copying}
          onClose={() => setEditingProduct(null)}
          onSaved={async (err) => {
            await done(err);
            if (!err) setEditingProduct(null);
          }}
        />
      )}
    </div>
  );

  switch (section) {
    case "products":
      return page(
        <>
          {productsToCheck.length > 0 && (
            <section className="panel mb-4" aria-labelledby="to-check">
              <h3 id="to-check">To check ({productsToCheck.length})</h3>
              <p className="small muted mt-1">
                Starting values Kathy hasn&apos;t confirmed yet. Open one, fix anything wrong, and tick &quot;These values are
                checked&quot;.
              </p>
              <ul className="m-0 grid list-none gap-1 p-0">
                {productsToCheck.map((c) => {
                  const prod = catalog.productById.get(c.id);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-3 border-t border-line py-1.5">
                      <b>{c.name}</b>
                      <span className="small muted mr-auto">{c.why}</span>
                      {prod && canEdit && (
                        <button type="button" className="btn ghost" onClick={() => open(prod)}>
                          Check
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <section className="panel">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="mr-auto">Products customers order</h3>
              {canEdit && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setCopying(false);
                    setEditingProduct("new");
                  }}
                >
                  Add a product
                </button>
              )}
            </div>
            <p className="small muted mt-1">
              What customers order, in their words: how it&apos;s ordered, what part of the lamb it comes from, and the Mohawk
              lines it&apos;s cut from. To start a new one from an old one, tap Copy.
            </p>
            {productTable(onProducts)}
            {offProducts.length > 0 && (
              <details className="mt-3">
                <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold">
                  Turned off ({offProducts.length})
                </summary>
                <p className="small muted mt-0">Kept so old orders and downloads still work. The old Mohawk-wording products are here.</p>
                {productTable(offProducts)}
              </details>
            )}
          </section>
        </>,
        true,
      );

    case "boxes":
      return page(
        <section className="panel">
          <p className="small muted mt-0">
            How much of each product fits in each box, largest box first. Products never share a box. Orders, Packing and the box
            labels use these to split each order into boxes.
          </p>
          <BoxLimits canEdit={canEdit} />
        </section>,
        true,
        <PackBlanks canEdit={canEdit} onDone={done} />,
      );

    case "parts":
      return page(
        <section className="panel">
          <h3>What one lamb gives you</h3>
          <table className="simple mt-2">
            <thead>
              <tr>
                <th>Part</th>
                <th>Per lamb</th>
                <th>Drives lamb count</th>
                <th>Where it came from</th>
              </tr>
            </thead>
            <tbody>
              {catalog.parts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b> <span className="small muted">{p.unit}</span>
                  </td>
                  <td>
                    <input
                      key={`${p.id}:${p.per_lamb}`}
                      className={`field num w-[5.5rem]! ${p.confirmed ? "" : "unconfirmed"}`}
                      inputMode="decimal"
                      aria-label={`${p.name} per lamb`}
                      defaultValue={fmt(p.per_lamb)}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        // Save only when the text was changed, never just because someone tabbed through.
                        if (e.target.value.trim() === fmt(p.per_lamb)) return;
                        const v = Math.max(0, num(e.target.value));
                        if (v !== p.per_lamb) void updateRow(db, "parts", p.id, { per_lamb: v }).then(done);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="h-6 w-6 accent-forest"
                      aria-label={`${p.name} drives the lamb count`}
                      checked={p.drives_count}
                      disabled={!canEdit}
                      onChange={(e) => void updateRow(db, "parts", p.id, { drives_count: e.target.checked }).then(done)}
                    />
                  </td>
                  <td className="small">
                    {p.source_note}
                    {!p.confirmed && canEdit && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="copy"
                          onClick={() => void updateRow(db, "parts", p.id, { confirmed: true }).then(done)}
                        >
                          Mark confirmed
                        </button>
                      </>
                    )}
                    {!p.confirmed && !canEdit && <span className="tag extra ml-1">Not confirmed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted mt-2 mb-0">
            Parts that don&apos;t drive the count (necks, trim, Denver ribs) are byproducts: tracked per lamb, but ordering
            more of them never raises the number of lambs.
          </p>
          {canEdit &&
            (addingPart ? (
              <AddPart
                onDone={async (err) => {
                  if (err !== undefined) await done(err);
                  if (!err) setAddingPart(false);
                }}
              />
            ) : (
              <button type="button" className="btn ghost mt-2" onClick={() => setAddingPart(true)}>
                Add a part
              </button>
            ))}
        </section>,
      );

    case "instructions":
      return page(
        <section className="panel">
          <p className="small muted mt-0">
            The exact wording printed on the cut sheet, in the order the cut sheet lists them. &quot;Counts as&quot; is how a line
            adds up when a set is checked. Changing it changes every set that uses it, including past weeks.
          </p>
          <CutSpecs canEdit={canEdit} done={done} />
        </section>,
        true,
      );

    case "sizes":
      return page(
        <section className="panel">
          <table className="simple">
            <thead>
              <tr>
                <th>Size</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {catalog.sizes.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      className="field"
                      aria-label={`Name for ${s.id}`}
                      defaultValue={s.label}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== s.label) void updateRow(db, "size_classes", s.id, { label: v }).then(done);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="field"
                      aria-label={`Weight for ${s.label}`}
                      defaultValue={s.weight_range}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== s.weight_range) void updateRow(db, "size_classes", s.id, { weight_range: v }).then(done);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>,
      );

    case "pallets":
      return page(
        <section className="panel">
          <p className="small muted mt-0">
            Each customer or location ships direct (its own shipment and pallets), or through a distributor that takes every
            store&apos;s boxes together and sends them on (PCC). Scan boxes uses this to choose the pallet.
          </p>
          <ShipsTo canEdit={canEdit} />
        </section>,
      );

    case "gtins":
      return page(
        <section className="panel">
          <p className="small muted mt-0">
            Which product each Mohawk box label is. Every product has its own GTIN, so the app is told once, here or the first
            time a box is scanned. Only an admin can add or change one.
          </p>
          <GtinMap canEdit={canEdit} />
        </section>,
      );

    case "le-trim":
      return page(
        <section className="panel">
          <p className="small muted mt-0">
            Le Trim is made from extra shoulders (boned out) or half legs, each with trim. These two numbers only estimate how
            much trim a week&apos;s Le Trim takes; on the Le Trim screen Kathy enters what she actually used. Still to confirm
            with Kathy.
          </p>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["le_trim_shoulder_trim_lb", "Trim with each shoulder (lb)", 5],
                ["le_trim_half_leg_trim_lb", "Trim with each half leg (lb)", 6.5],
              ] as const
            ).map(([key, label, dflt]) => (
              <label key={key} className="grid gap-1">
                <span className="lbl m-0">{label}</span>
                <input
                  key={`${key}:${settings?.[key] ?? dflt}`}
                  className="field num w-28!"
                  inputMode="decimal"
                  defaultValue={fmt(num(settings?.[key] ?? dflt))}
                  disabled={!canEdit}
                  onBlur={(e) => {
                    const v = Math.max(0, num(e.target.value));
                    if (v !== num(settings?.[key] ?? dflt)) void updateSettings(db, { [key]: v }).then(done);
                  }}
                />
              </label>
            ))}
          </div>
        </section>,
      );

    case "processor":
      return page(
        <section className="panel">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[160px] flex-1">
              <label className="lbl" htmlFor="pname">
                Name
              </label>
              <input
                id="pname"
                className="field"
                defaultValue={settings?.processor_name ?? "Mohawk"}
                disabled={!canEdit}
                onBlur={(e) => {
                  const v = e.target.value.trim() || "Mohawk";
                  if (v !== settings?.processor_name) void updateSettings(db, { processor_name: v }).then(done);
                }}
              />
            </div>
            <div className="min-w-[220px] flex-[2]">
              <label className="lbl" htmlFor="pemail">
                Email for cut sheets
              </label>
              <input
                id="pemail"
                className="field"
                inputMode="email"
                defaultValue={settings?.processor_email ?? ""}
                disabled={!canEdit}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (settings?.processor_email ?? "")) void updateSettings(db, { processor_email: v }).then(done);
                }}
              />
            </div>
          </div>
          <label className="lbl" htmlFor="pstand">
            Instructions that go on every cut sheet
          </label>
          <textarea
            id="pstand"
            className="field"
            rows={3}
            placeholder="One per line. Packaging, labels, anything they should always do"
            defaultValue={settings?.standing_instructions ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (settings?.standing_instructions ?? "")) void updateSettings(db, { standing_instructions: v }).then(done);
            }}
          />
        </section>,
      );

    case "records":
      if (!canEdit) return page(<p className="note">Only an admin can export all data.</p>);
      return page(
        <section className="panel">
          <p className="small muted mt-0">
            Download everything in the app, one spreadsheet file per list, in a single zip file. Keep a copy somewhere safe.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export" className="btn" download>
              Export all data (CSV files in a zip)
            </a>
            <a href="/api/export?format=xlsx" className="btn ghost" download>
              Export all data (one Excel workbook)
            </a>
          </div>
          <p className="small muted mt-2 mb-0">
            The zip of CSV files is the one to keep for moving the data to new accounts. The Excel workbook is easier to look
            through: one tab per list.
          </p>
        </section>,
      );
  }
}

/** Add a part to track per lamb (for example a byproduct like bellies). */
function AddPart({ onDone }: { onDone: (err?: string | null) => Promise<void> }) {
  const db = getDb();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<"each" | "lb">("each");
  const [per, setPer] = useState("1");
  const [drives, setDrives] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-line p-3">
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[150px] flex-1">
          <label className="lbl mt-0!" htmlFor="np-name">
            Part name
          </label>
          <input id="np-name" className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="lbl mt-0!" htmlFor="np-per">
            Per lamb
          </label>
          <input
            id="np-per"
            className="field num w-24!"
            inputMode="decimal"
            value={per}
            onChange={(e) => setPer(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
        <div>
          <label className="lbl mt-0!" htmlFor="np-unit">
            Counted in
          </label>
          <select id="np-unit" className="field" value={unit} onChange={(e) => setUnit(e.target.value as "each" | "lb")}>
            <option value="each">Pieces</option>
            <option value="lb">Pounds</option>
          </select>
        </div>
      </div>
      <label className="flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={drives} onChange={(e) => setDrives(e.target.checked)} />
        Drives the lamb count (leave off for byproducts)
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={() => void onDone()}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const err = await addPart(db, { name: name.trim(), unit, per_lamb: Math.max(0, num(per)), drives_count: drives });
            setBusy(false);
            await onDone(err);
          }}
        >
          Add part
        </button>
      </div>
    </div>
  );
}

/** Cut sheet instructions: wording, what each counts as, order, in use, add, and delete if never used. */
function CutSpecs({ canEdit, done }: { canEdit: boolean; done: (err: string | null) => Promise<void> }) {
  const { catalog } = useStaffData();
  const toast = useToast();
  const db = getDb();
  const [text, setText] = useState("");
  const [use, setUse] = useState("leg");
  const [busy, setBusy] = useState(false);
  const specs = catalog?.cutSpecs ?? [];

  return (
    <>
      <table className="simple">
        <thead>
          <tr>
            <th>Wording</th>
            <th>Counts as</th>
            <th>In use</th>
            {canEdit && (
              <th>
                <span className="sr-only">Move or delete</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {specs.map((s, i) => (
            <tr key={s.id} className={s.active ? "" : "bg-field"}>
              <td className="min-w-[220px]">
                <input
                  key={`${s.id}:${s.text}`}
                  className="field"
                  aria-label="Wording"
                  defaultValue={s.text}
                  disabled={!canEdit}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== s.text) void updateRow(db, "cut_specs", s.id, { text: v }).then(done);
                  }}
                />
              </td>
              <td>
                <select
                  className="field"
                  aria-label={`What ${s.text} counts as`}
                  value={s.use_type}
                  disabled={!canEdit}
                  onChange={(e) => void updateRow(db, "cut_specs", s.id, { use_type: e.target.value }).then(done)}
                >
                  {Object.entries(USE_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  className="h-6 w-6 accent-forest"
                  aria-label={`In use: ${s.text}`}
                  checked={s.active}
                  disabled={!canEdit}
                  onChange={(e) => void updateRow(db, "cut_specs", s.id, { active: e.target.checked }).then(done)}
                />
              </td>
              {canEdit && (
                <td className="whitespace-nowrap">
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={`Move ${s.text} up`}
                    disabled={i === 0}
                    onClick={() => void swapSpecSort(db, s, specs[i - 1]).then(done)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={`Move ${s.text} down`}
                    disabled={i === specs.length - 1}
                    onClick={() => void swapSpecSort(db, s, specs[i + 1]).then(done)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="copy min-h-[44px] px-2"
                    onClick={async () => {
                      if (!window.confirm(`Delete "${s.text}"? This can't be undone.`)) return;
                      const r = await deleteCutSpec(db, s.id);
                      if (r.inUse) toast(r.inUse);
                      else await done(r.error);
                    }}
                  >
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="lbl" htmlFor="ns-text">
              New instruction
            </label>
            <input
              id="ns-text"
              className="field"
              value={text}
              placeholder="Wording exactly as Mohawk should read it"
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div>
            <label className="lbl" htmlFor="ns-use">
              Counts as
            </label>
            <select id="ns-use" className="field" value={use} onChange={(e) => setUse(e.target.value)}>
              {Object.entries(USE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              const r = await addCutSpec(db, text.trim(), use);
              setBusy(false);
              if (!r.error) setText("");
              await done(r.error);
            }}
          >
            Add instruction
          </button>
        </div>
      )}
    </>
  );
}

/** Pallet groups: name, order, and the customers in each with their spot. */
function ShipsTo({ canEdit }: { canEdit: boolean }) {
  const { customers, reloadCustomers } = useStaffData();
  const toast = useToast();
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => loadPoints(d), []);
  const { data: points, refresh } = useLive("consolidation-points", load, ["consolidation_points"]);
  const [name, setName] = useState("");
  if (!points || !customers) return <p className="small muted">Loading...</p>;

  const after = async (err: string | null) => {
    if (err) toast(`Couldn't save: ${err}`);
    else toast("Saved");
    refresh();
    await reloadCustomers();
  };
  const byId = customers.byId;
  // Customers that get boxes: locations, and customers without locations.
  const hasLocations = new Set(customers.list.map((c) => c.parent_customer_id).filter(Boolean));
  const list = sortByDisplayName(
    customers.list.filter((c) => c.active && !hasLocations.has(c.id)),
    byId,
  );
  const pointName = (id: string | null) => (id ? (points.find((p) => p.id === id)?.name ?? "Distributor") : "Direct");

  return (
    <>
      <h3>Distributors</h3>
      <ul className="m-0 mt-1 grid list-none gap-2 p-0">
        {points.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2">
            <input
              key={`${p.id}:${p.name}`}
              className="field max-w-[22rem]"
              aria-label="Distributor name"
              defaultValue={p.name}
              disabled={!canEdit}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== p.name) void updatePoint(db, p.id, { name: v }).then(after);
              }}
            />
            <span className="small muted">
              {customers.list.filter((c) => c.ships_to_point_id === p.id).length} customers ship here
            </span>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void addPoint(db, name.trim()).then((err) => {
              setName("");
              void after(err);
            });
          }}
        >
          <input className="field max-w-[22rem]" placeholder="New distributor's name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn ghost" disabled={!name.trim()}>
            Add distributor
          </button>
        </form>
      )}

      <h3 className="mt-5">Ships to</h3>
      <table className="simple mt-2">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Ships to</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td>{displayName(c, byId)}</td>
              <td>
                {canEdit ? (
                  <select
                    className="field w-auto!"
                    aria-label={`Ships to for ${displayName(c, byId)}`}
                    value={c.ships_to_point_id ?? ""}
                    onChange={(e) => void setShipsTo(db, [c.id], e.target.value || null).then(after)}
                  >
                    <option value="">Direct</option>
                    {points
                      .filter((p) => p.active || p.id === c.ships_to_point_id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  pointName(c.ships_to_point_id)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** The GTIN on a box label, and which product it is (SPEC 11.3). Admins edit. */
function GtinMap({ canEdit }: { canEdit: boolean }) {
  const { catalog } = useStaffData();
  const toast = useToast();
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => loadGtins(d), []);
  const { data: rows, refresh } = useLive("gtin-products", load, ["gtin_products"]);
  const [gtin, setGtin] = useState("");
  const [productId, setProductId] = useState("");
  if (!rows || !catalog) return <p className="small muted">Loading...</p>;

  const products = catalog.products.filter((p) => p.active);
  const name = (id: string) => catalog.productById.get(id)?.name ?? id;
  const after = (err: string | null) => {
    if (err) toast(`Couldn't save: ${err}`);
    refresh();
  };
  const clean = gtin.replace(/\D/g, "");
  const gtinProblem =
    !clean ? null : clean.length !== 14 ? "A GTIN has 14 digits." : !gtinCheckDigitOk(clean) ? "That GTIN's last digit doesn't check out. Look again." : rows.some((r) => r.gtin === clean) ? "That GTIN is already listed." : null;

  return (
    <>
      {rows.length === 0 ? (
        <p className="small muted">None yet. They&apos;re added the first time each kind of box is scanned.</p>
      ) : (
        <table className="simple mb-3">
          <thead>
            <tr>
              <th>GTIN</th>
              <th>Product</th>
              {canEdit && <th className="sr-only">Remove</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.gtin}>
                <td className="num">{r.gtin}</td>
                <td>
                  {canEdit ? (
                    <select
                      className="field"
                      aria-label={`Product for GTIN ${r.gtin}`}
                      value={r.product_id}
                      onChange={(e) => void saveGtin(db, r.gtin, e.target.value, r.note).then(after)}
                    >
                      {!products.some((p) => p.id === r.product_id) && <option value={r.product_id}>{name(r.product_id)}</option>}
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    name(r.product_id)
                  )}
                </td>
                {canEdit && (
                  <td>
                    <button
                      type="button"
                      className="iconbtn"
                      aria-label={`Remove GTIN ${r.gtin}`}
                      onClick={() => {
                        if (confirm(`Remove GTIN ${r.gtin} (${name(r.product_id)})? Boxes already scanned keep their product.`))
                          void deleteGtin(db, r.gtin).then(after);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="lbl m-0">GTIN (14 digits, from the label)</span>
            <input className="field num" inputMode="numeric" value={gtin} onChange={(e) => setGtin(e.target.value)} placeholder="10698746488816" />
          </label>
          <label className="grid gap-1">
            <span className="lbl m-0">Product</span>
            <select className="field" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Choose a product...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={!clean || !productId || !!gtinProblem}
            onClick={() =>
              void saveGtin(db, clean, productId).then((e) => {
                after(e);
                if (!e) {
                  setGtin("");
                  setProductId("");
                }
              })
            }
          >
            Add
          </button>
          {gtinProblem && <p className="small text-barn m-0 w-full">{gtinProblem}</p>}
        </div>
      )}
    </>
  );
}

/** Weight blanks on the paper packing copy (change request 10/26/26): how many when a product's box count isn't known, spares after known boxes, and a number for any one product. */
function PackBlanks({ canEdit, onDone }: { canEdit: boolean; onDone: (err: string | null) => Promise<void> }) {
  const { catalog } = useStaffData();
  const db = getDb();
  if (!catalog) return null;
  const s = catalog.settings;
  const unknown = num(s?.pack_unknown_blanks ?? 6);
  const spare = num(s?.pack_spare_blanks ?? 2);
  const whole = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(num(v))));
  return (
    <section className="panel mt-4">
      <h3>Weight blanks on the paper packing copy</h3>
      <p className="small muted mt-1">
        Each box gets a blank with its label number. When a product&apos;s box count isn&apos;t known (no box size), it gets
        blanks with a space to write the label number.
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="grid gap-1">
          <span className="lbl m-0">Blanks when the box count isn&apos;t known</span>
          <input
            key={`u:${unknown}`}
            className="field num w-28!"
            inputMode="numeric"
            defaultValue={unknown}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = whole(e.target.value, 1, 30);
              if (v !== unknown) void updateSettings(db, { pack_unknown_blanks: v }).then(onDone);
            }}
          />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Spare blanks after the known boxes</span>
          <input
            key={`s:${spare}`}
            className="field num w-28!"
            inputMode="numeric"
            defaultValue={spare}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = whole(e.target.value, 0, 10);
              if (v !== spare) void updateSettings(db, { pack_spare_blanks: v }).then(onDone);
            }}
          />
        </label>
      </div>
      <details className="mt-3">
        <summary className="copy">A different number for one product</summary>
        <p className="small muted">Only used when that product&apos;s box count isn&apos;t known. Leave it blank for {unknown}.</p>
        <table className="simple mt-2">
          <thead>
            <tr>
              <th>Product</th>
              <th>Blanks</th>
            </tr>
          </thead>
          <tbody>
            {catalog.products
              .filter((p) => p.active)
              .map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <input
                      key={`${p.id}:${p.pack_blanks ?? ""}`}
                      className="field num w-20!"
                      inputMode="numeric"
                      aria-label={`Blanks for ${p.name}`}
                      placeholder={String(unknown)}
                      defaultValue={p.pack_blanks ?? ""}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim() === "" ? null : whole(e.target.value, 1, 30);
                        if (v !== (p.pack_blanks ?? null)) void saveProductPackBlanks(db, p.id, v).then(onDone);
                      }}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
