"use client";

// Setup (SPEC 5.10): parts per lamb, cut specs, products, size classes, and
// the processor. Admin and office can look; only admins can change things.

import { useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { fmt, num } from "@/lib/calc/num";
import { saveProduct, updateRow, updateSettings } from "@/lib/db/save";
import type { CatalogProduct } from "@/lib/db/types";

const GROUPS = ["Legs", "Shoulders", "Racks", "Loins", "Shanks", "Ground and trim", "Whole lambs", "Other"];
const UNITS = ["each", "lb", "leg", "loin", "lamb"];

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
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);

  if (error) return <p className="note bad">Couldn&apos;t load Setup: {error}</p>;
  if (!catalog) return <div className="empty">Loading...</div>;

  async function done(err: string | null) {
    if (err) toast(`Couldn't save: ${err}`);
    else toast("Saved");
    await reloadCatalog();
  }

  const partName = (id: string) => catalog.parts.find((p) => p.id === id)?.name ?? id;
  const settings = catalog.settings;

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

      <div className="grid2">
        <section className="panel">
          <h3>What one lamb gives you</h3>
          <table className="simple mt-2">
            <thead>
              <tr>
                <th>Part</th>
                <th>Per lamb</th>
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
                        const v = Math.max(0, num(e.target.value));
                        if (v !== p.per_lamb) void updateRow(db, "parts", p.id, { per_lamb: v }).then(done);
                      }}
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
        <h3>Products and the parts they use</h3>
        <p className="small muted mt-1">What customers order, and how much of the lamb one of each takes.</p>
        <table className="simple">
          <thead>
            <tr>
              <th>Product</th>
              <th>Uses</th>
              <th>
                <span className="sr-only">Change</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {catalog.products.map((p) => (
              <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                <td>
                  <b>{p.name}</b>
                  <br />
                  <span className="small muted">
                    {[p.group_name, p.short_name, p.unit, p.fresh_only ? "fresh only" : "", p.active ? "" : "not active"]
                      .filter(Boolean)
                      .join(" · ")}
                    {p.note ? `. ${p.note}` : ""}
                  </span>
                </td>
                <td className="small">{p.uses.map((u) => `${fmt(u.qty)} ${partName(u.part_id)}`).join(" + ")}</td>
                <td className="text-right">
                  {canEdit && (
                    <button type="button" className="btn ghost" onClick={() => setEditingProduct(p)}>
                      Change
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel mt-4">
        <h3>Instructions for {settings?.processor_name || "Mohawk"} (cut specs)</h3>
        <p className="small muted mt-1">The exact wording printed on the cut sheet. Turn off ones you no longer use.</p>
        <table className="simple">
          <thead>
            <tr>
              <th>Wording</th>
              <th>Counts as</th>
              <th>In use</th>
            </tr>
          </thead>
          <tbody>
            {catalog.cutSpecs.map((s) => (
              <tr key={s.id} className={s.active ? "" : "opacity-60"}>
                <td>
                  <input
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
                <td className="small">{USE_LABEL[s.use_type] ?? s.use_type}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editingProduct && (
        <EditProduct
          product={editingProduct}
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

function EditProduct({
  product,
  onClose,
  onSaved,
}: {
  product: CatalogProduct;
  onClose: () => void;
  onSaved: (err: string | null) => Promise<void>;
}) {
  const { catalog } = useStaffData();
  const [p, setP] = useState({ ...product, uses: product.uses.map((u) => ({ part_id: u.part_id, qty: String(u.qty) })) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP((x) => ({ ...x, [k]: v }));
  const unusedParts = (catalog?.parts ?? []).filter((pt) => !p.uses.some((u) => u.part_id === pt.id));

  return (
    <Sheet title="Change product" onClose={onClose}>
      <label className="lbl" htmlFor="pr-name">
        Name
      </label>
      <input id="pr-name" className="field" value={p.name} onChange={(e) => set("name", e.target.value)} />
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[150px] flex-1">
          <label className="lbl" htmlFor="pr-short">
            Short name (for the grid)
          </label>
          <input id="pr-short" className="field" value={p.short_name} onChange={(e) => set("short_name", e.target.value)} />
        </div>
        <div className="min-w-[120px] flex-1">
          <label className="lbl" htmlFor="pr-unit">
            Sold by
          </label>
          <select id="pr-unit" className="field" value={p.unit} onChange={(e) => set("unit", e.target.value)}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[150px] flex-1">
          <label className="lbl" htmlFor="pr-group">
            Group
          </label>
          <select id="pr-group" className="field" value={p.group_name} onChange={(e) => set("group_name", e.target.value)}>
            {GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="lbl">Parts one of these uses</p>
      {p.uses.map((u, i) => (
        <div key={u.part_id} className="mb-2 flex items-center gap-2">
          <input
            className="field num w-24!"
            inputMode="decimal"
            aria-label={`Amount of ${u.part_id}`}
            value={u.qty}
            onChange={(e) =>
              set(
                "uses",
                p.uses.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^0-9.]/g, "") } : x)),
              )
            }
          />
          <span className="flex-1">{catalog?.parts.find((pt) => pt.id === u.part_id)?.name ?? u.part_id}</span>
          <button type="button" className="copy min-h-[44px]" onClick={() => set("uses", p.uses.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      {unusedParts.length > 0 && (
        <select
          className="field"
          aria-label="Add a part"
          value=""
          onChange={(e) => e.target.value && set("uses", [...p.uses, { part_id: e.target.value, qty: "1" }])}
        >
          <option value="">Add a part...</option>
          {unusedParts.map((pt) => (
            <option key={pt.id} value={pt.id}>
              {pt.name}
            </option>
          ))}
        </select>
      )}

      <label className="lbl" htmlFor="pr-note">
        Note
      </label>
      <input id="pr-note" className="field" value={p.note} onChange={(e) => set("note", e.target.value)} />

      <label className="mt-3 flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={p.fresh_only} onChange={(e) => set("fresh_only", e.target.checked)} />
        Fresh only (never filled from the freezer)
      </label>
      <label className="flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={p.active} onChange={(e) => set("active", e.target.checked)} />
        Active (shows when entering orders)
      </label>

      {error && <p className="note bad mt-3">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            if (!p.name.trim()) return setError("Add a name.");
            setBusy(true);
            const err = await saveProduct(getDb(), {
              id: p.id,
              name: p.name.trim(),
              short_name: p.short_name.trim(),
              unit: p.unit,
              group_name: p.group_name,
              fresh_only: p.fresh_only,
              active: p.active,
              note: p.note.trim(),
              uses: p.uses.map((u) => ({ part_id: u.part_id, qty: num(u.qty) })),
            });
            setBusy(false);
            await onSaved(err);
          }}
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </Sheet>
  );
}
