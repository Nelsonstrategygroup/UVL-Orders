"use client";

// Setup (SPEC 5.10): parts per lamb, cut specs, products, size classes, and
// the processor. Admin and office can look; only admins can change things.

import { useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { fmt, num } from "@/lib/calc/num";
import { drivesLambCount, needsChecking, partAmountRow } from "@/lib/calc/products";
import { unitWord } from "@/lib/calc/units";
import { addPart, deleteCutSpec, swapSpecSort, updateRow, updateSettings } from "@/lib/db/save";
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

export default function SetupScreen({ canEdit }: { canEdit: boolean }) {
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

  return (
    <>
      <h2 className="mb-2">Setup</h2>
      {canEdit ? (
        <p className="note small">
          Numbers highlighted in yellow are starting guesses. Correct them here and every calculation updates.
        </p>
      ) : (
        <p className="note small">Only an admin can change these. Ask Kathy or Eric if something looks wrong.</p>
      )}

      {toCheck.length > 0 && (
        <section className="panel mb-4" aria-labelledby="to-check">
          <h3 id="to-check">Needs checking ({toCheck.length})</h3>
          <p className="small muted mt-1">
            Starting values Kathy hasn&apos;t confirmed yet. Open one, fix anything wrong, and tick &quot;These values are
            checked&quot;.
          </p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {toCheck.map((c) => {
              const prod = c.kind === "product" ? catalog.productById.get(c.id) : undefined;
              return (
                <li key={`${c.kind}-${c.id}`} className="flex flex-wrap items-center gap-x-3 border-t border-line py-1.5">
                  <b>{c.name}</b>
                  <span className="small muted mr-auto">{c.why}</span>
                  {prod && canEdit && (
                    <button type="button" className="btn ghost" onClick={() => open(prod)}>
                      Check
                    </button>
                  )}
                  {c.kind === "part" && <span className="small muted">Below, under parts per lamb</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid2">
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
        </section>

        <section className="panel">
          <h3>Processor</h3>
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

          <h3 className="mt-5">Lamb sizes</h3>
          <table className="simple mt-2">
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
        </section>
      </div>

      <section className="panel mt-4">
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
            <p className="small muted mt-0">
              Kept so old orders and downloads still work. The old Mohawk-wording products are here.
            </p>
            {productTable(offProducts)}
          </details>
        )}
      </section>

      <section className="panel mt-4">
        <h3>Instructions for {settings?.processor_name || "Mohawk"} (cut specs)</h3>
        <p className="small muted mt-1">
          The exact wording printed on the cut sheet, in the order the cut sheet lists them. &quot;Counts as&quot; is how a line
          adds up when a set is checked. Changing it changes every set that uses it, including past weeks.
        </p>
        <CutSpecs canEdit={canEdit} done={done} />
      </section>

      {canEdit && (
        <section className="panel mt-4">
          <h3>Your records</h3>
          <p className="small muted mt-1">
            Download everything in the app, one spreadsheet file per list, in a single zip file. Keep a copy somewhere safe.
          </p>
          <a href="/api/export" className="btn" download>
            Export all data
          </a>
        </section>
      )}

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
    </>
  );
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
