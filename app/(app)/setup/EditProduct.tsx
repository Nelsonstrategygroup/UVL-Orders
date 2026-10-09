"use client";

// Add, change, or copy a customer product (change requests 10/2026, item 2).
// Only the name is required; everything else starts from sensible defaults.

import { useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import Sheet from "@/components/Sheet";
import { fmt, num } from "@/lib/calc/num";
import { drivesLambCount, partAmountQty, partAmountRow, type UseMode } from "@/lib/calc/products";
import { ORDER_UNITS, UNIT_NAME, unitWord } from "@/lib/calc/units";
import { saveProduct } from "@/lib/db/save";
import type { CatalogProduct, OrderUnit } from "@/lib/db/types";

type UseDraft = { part_id: string; mode: UseMode; amount: string };
type LinkDraft = { cut_spec_id: string; units_per_cut: string };

const blank = {
  id: null as string | null,
  name: "",
  short_name: "",
  unit: "each",
  alt_unit: null as OrderUnit | null,
  group_name: "",
  lb_per_unit: null as number | null,
  pieces_per_pack: null as number | null,
  order_step: 1,
  billed_by_weight: true,
  counts_toward_lambs: true,
  not_lamb: false,
  confirmed: true,
  fresh_only: false,
  active: true,
  note: "",
  uses: [] as { part_id: string; qty: number }[],
  links: [] as { cut_spec_id: string; units_per_cut: number }[],
};

const numText = (v: number | null | undefined) => (v == null || !v ? "" : fmt(v));
const clean = (v: string) => v.replace(/[^0-9.]/g, "");

export default function EditProduct({
  product,
  copy,
  onClose,
  onSaved,
}: {
  /** The product to change or copy; null to add a new one. */
  product: CatalogProduct | null;
  /** Start a new product from this one. */
  copy?: boolean;
  onClose: () => void;
  onSaved: (err: string | null) => Promise<void>;
}) {
  const { catalog } = useStaffData();
  const start = product ?? blank;
  const [f, setF] = useState(() => ({
    ...start,
    id: copy ? null : start.id,
    name: copy ? `${start.name} (copy)` : start.name,
    confirmed: copy ? false : start.confirmed,
    lb: numText(start.lb_per_unit),
    perPack: numText(start.pieces_per_pack),
    step: fmt(start.order_step || 1),
    useRows: start.uses.map((u): UseDraft => {
      const r = partAmountRow(u.qty);
      return { part_id: u.part_id, mode: r.mode, amount: fmt(r.amount) };
    }),
    linkRows: start.links.map((l): LinkDraft => ({ cut_spec_id: l.cut_spec_id, units_per_cut: fmt(l.units_per_cut) })),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const parts = catalog?.parts ?? [];
  const specs = (catalog?.cutSpecs ?? []).filter((s) => s.active || f.linkRows.some((l) => l.cut_spec_id === s.id));
  const groups = [...new Set((catalog?.products ?? []).filter((p) => p.active).map((p) => p.group_name))].sort();
  const unusedParts = parts.filter((pt) => !f.useRows.some((u) => u.part_id === pt.id));
  const one = unitWord(f.unit, 1);
  const twoUnits = !!f.alt_unit;
  const needsWeight = f.unit !== "lb" || twoUnits;
  const uses = f.useRows.map((u) => ({ part_id: u.part_id, qty: partAmountQty(u.mode, num(u.amount)) }));
  const drives = drivesLambCount({ ...f, id: f.id ?? "", uses }, parts);

  async function save() {
    if (!f.name.trim()) return setError("Add the name customers see.");
    setBusy(true);
    const err = await saveProduct(getDb(), {
      id: f.id,
      name: f.name.trim(),
      short_name: f.short_name.trim(),
      unit: f.unit,
      alt_unit: f.alt_unit && f.alt_unit !== f.unit ? f.alt_unit : null,
      group_name: f.group_name.trim() || "Other",
      lb_per_unit: num(f.lb) > 0 ? num(f.lb) : null,
      pieces_per_pack: num(f.perPack) > 0 ? num(f.perPack) : null,
      order_step: num(f.step) > 0 ? num(f.step) : 1,
      billed_by_weight: f.billed_by_weight,
      counts_toward_lambs: f.counts_toward_lambs,
      not_lamb: f.not_lamb,
      confirmed: f.confirmed,
      fresh_only: f.fresh_only,
      active: f.active,
      note: f.note.trim(),
      uses,
      links: f.linkRows.map((l) => ({ cut_spec_id: l.cut_spec_id, units_per_cut: num(l.units_per_cut) || 1 })),
    });
    setBusy(false);
    await onSaved(err);
  }

  const partName = (id: string) => parts.find((p) => p.id === id)?.name ?? id;

  return (
    <Sheet title={copy ? "Copy a product" : product ? "Change product" : "Add a product"} onClose={onClose}>
      <label className="lbl" htmlFor="pr-name">
        Name customers see
      </label>
      <input id="pr-name" className="field" autoFocus={!product || copy} value={f.name} onChange={(e) => set("name", e.target.value)} />

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[140px] flex-1">
          <label className="lbl" htmlFor="pr-unit">
            Ordered in
          </label>
          <select id="pr-unit" className="field" value={f.unit} onChange={(e) => set("unit", e.target.value)}>
            {ORDER_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_NAME[u]}
              </option>
            ))}
            {!ORDER_UNITS.includes(f.unit as OrderUnit) && <option value={f.unit}>{f.unit}</option>}
          </select>
        </div>
        <div className="min-w-[140px] flex-1">
          <label className="lbl" htmlFor="pr-alt">
            Or also in
          </label>
          <select
            id="pr-alt"
            className="field"
            value={f.alt_unit ?? ""}
            onChange={(e) => set("alt_unit", (e.target.value || null) as OrderUnit | null)}
          >
            <option value="">Only {UNIT_NAME[f.unit as OrderUnit]?.toLowerCase() ?? f.unit}</option>
            {ORDER_UNITS.filter((u) => u !== f.unit).map((u) => (
              <option key={u} value={u}>
                {UNIT_NAME[u]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[140px] flex-1">
          <label className="lbl" htmlFor="pr-group">
            Group on the order screen
          </label>
          <input
            id="pr-group"
            className="field"
            list="pr-groups"
            value={f.group_name}
            placeholder="Loins and chops"
            onChange={(e) => set("group_name", e.target.value)}
          />
          <datalist id="pr-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {needsWeight && (
          <div className="min-w-[140px] flex-1">
            <label className="lbl" htmlFor="pr-lb">
              About how many lb is one {f.unit === "lb" ? unitWord(f.alt_unit ?? "each", 1) : one}?
            </label>
            <input id="pr-lb" className="field num" inputMode="decimal" value={f.lb} onChange={(e) => set("lb", clean(e.target.value))} />
            <p className="small muted mt-1 mb-0">
              {twoUnits ? "Needed to turn pounds into pieces." : "Optional. Helps when billing by weight."}
            </p>
          </div>
        )}
        {(f.unit === "pack" || f.alt_unit === "pack") && (
          <div className="min-w-[140px] flex-1">
            <label className="lbl" htmlFor="pr-pp">
              Pieces per pack
            </label>
            <input
              id="pr-pp"
              className="field num"
              inputMode="decimal"
              value={f.perPack}
              onChange={(e) => set("perPack", clean(e.target.value))}
            />
          </div>
        )}
        <div className="min-w-[140px] flex-1">
          <label className="lbl" htmlFor="pr-step">
            + and − go up by
          </label>
          <input id="pr-step" className="field num" inputMode="decimal" value={f.step} onChange={(e) => set("step", clean(e.target.value))} />
          <p className="small muted mt-1 mb-0">For example 10 for Le Trim (10, 20, 30 lb).</p>
        </div>
      </div>

      <label className="mt-3 flex min-h-[44px] items-center gap-3">
        <input
          type="checkbox"
          className="h-6 w-6 accent-forest"
          checked={f.not_lamb}
          onChange={(e) => setF((x) => ({ ...x, not_lamb: e.target.checked, billed_by_weight: e.target.checked ? false : x.billed_by_weight }))}
        />
        Not a lamb product (for example pepper sticks: counted, not weighed, uses no parts)
      </label>

      {!f.not_lamb && (
        <>
          <p className="lbl">Comes from</p>
          {f.useRows.map((u, i) => {
            const setRow = (patch: Partial<UseDraft>) => set("useRows", f.useRows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={u.part_id} className="mb-2 flex flex-wrap items-center gap-2">
                <input
                  className="field num w-20!"
                  inputMode="decimal"
                  aria-label={`Amount for ${partName(u.part_id)}`}
                  value={u.amount}
                  onChange={(e) => setRow({ amount: clean(e.target.value) })}
                />
                <select
                  className="field w-auto!"
                  aria-label={`How the amount for ${partName(u.part_id)} is said`}
                  value={u.mode}
                  onChange={(e) => setRow({ mode: e.target.value as UseMode })}
                >
                  <option value="per-part">
                    {unitWord(f.unit)} per {partName(u.part_id).toLowerCase()}
                  </option>
                  <option value="per-unit">
                    {partName(u.part_id).toLowerCase()} per {one}
                  </option>
                </select>
                <button type="button" className="copy min-h-[44px]" onClick={() => set("useRows", f.useRows.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            );
          })}
          {unusedParts.length > 0 && (
            <select
              className="field"
              aria-label="Add a part it comes from"
              value=""
              onChange={(e) =>
                e.target.value && set("useRows", [...f.useRows, { part_id: e.target.value, mode: "per-unit", amount: "1" }])
              }
            >
              <option value="">Add a part it comes from...</option>
              {unusedParts.map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.name}
                </option>
              ))}
            </select>
          )}

          <label className="mt-2 flex min-h-[44px] items-center gap-3">
            <input
              type="checkbox"
              className="h-6 w-6 accent-forest"
              checked={f.counts_toward_lambs}
              onChange={(e) => set("counts_toward_lambs", e.target.checked)}
            />
            Counts toward how many lambs to order
          </label>
          <p className="small muted mt-0">
            {drives
              ? "Ordering this can raise the lamb count."
              : "This won't change the lamb count (it's a byproduct, uses no parts, or the box is off)."}
          </p>

          <p className="lbl">Mohawk cut sheet lines</p>
          {f.linkRows.map((l, i) => {
            const setLink = (patch: Partial<LinkDraft>) => set("linkRows", f.linkRows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={`${l.cut_spec_id}-${i}`} className="mb-2 grid gap-1 rounded-md border border-line p-2">
                <select
                  className="field"
                  aria-label="Mohawk line"
                  value={l.cut_spec_id}
                  onChange={(e) => setLink({ cut_spec_id: e.target.value })}
                >
                  {specs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.text}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="field num w-20!"
                    inputMode="decimal"
                    aria-label="How much of this product one line gives"
                    value={l.units_per_cut}
                    onChange={(e) => setLink({ units_per_cut: clean(e.target.value) })}
                  />
                  <span className="small">{unitWord(f.unit)} of this per line</span>
                  <button type="button" className="copy ml-auto min-h-[44px]" onClick={() => set("linkRows", f.linkRows.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          <select
            className="field"
            aria-label="Link a Mohawk line"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              // Start from the part amount when it's said per part (Chops: 2.5 lb per short loin).
              const perPart = f.useRows.find((u) => u.mode === "per-part");
              set("linkRows", [...f.linkRows, { cut_spec_id: e.target.value, units_per_cut: perPart?.amount || "1" }]);
            }}
          >
            <option value="">Link a Mohawk line...</option>
            {specs
              .filter((s) => !f.linkRows.some((l) => l.cut_spec_id === s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.text}
                </option>
              ))}
          </select>
          <p className="small muted mt-1">
            &quot;Put these on this set&quot; on the cut sheet adds orders to these lines. Customer-only wording (Nancy&apos;s tubs,
            Volcano cut) belongs on that customer&apos;s cut sheet lines, not here.
          </p>
        </>
      )}

      <label className="lbl" htmlFor="pr-note">
        Info for whoever takes the order
      </label>
      <textarea
        id="pr-note"
        className="field"
        rows={2}
        value={f.note}
        placeholder="Pieces per pack, pounds per short loin, anything handy"
        onChange={(e) => set("note", e.target.value)}
      />
      <p className="small muted mt-1">Shows behind an ⓘ button on the order screen.</p>

      <label className="mt-2 flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={f.billed_by_weight} onChange={(e) => set("billed_by_weight", e.target.checked)} />
        Billed by actual weight
      </label>
      <label className="flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={f.fresh_only} onChange={(e) => set("fresh_only", e.target.checked)} />
        Fresh only (never filled from the freezer)
      </label>
      <label className="flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
        Turned on (shows when entering orders)
      </label>
      <label className="flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={f.confirmed} onChange={(e) => set("confirmed", e.target.checked)} />
        These values are checked (takes it off the &quot;Needs checking&quot; list)
      </label>

      {error && <p className="note bad mt-3">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </Sheet>
  );
}
