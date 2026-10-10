"use client";

// One set on the cut sheet (SPEC 5.5): name, lambs, size, headline, lines,
// balance chips (6.3), and linked customers with "Put these on this set" (6.4).

import { useState } from "react";

import { chipText, hasCountedLines, lineType, setBalance, USE_GROUPS, USES, type CutSpecLite } from "@/lib/calc/cutsheet";
import { displayName } from "@/lib/calc/customers";
import { fmt, num } from "@/lib/calc/num";
import type { SheetLine, SheetSet } from "@/lib/db/cutsheet";
import type { CatalogProduct, CustomersData, CutSpec, Qty, SizeClass, Units } from "@/lib/db/types";
import { inProductUnits } from "@/lib/calc/units";
import { qtyText } from "@/lib/orders";

const NOTE = "__note";
const NEW = "__new";
const ONCE = "__once";
const HIGHLIGHTS: (SheetLine["highlight"])[] = [null, "yellow", "blue", "green"];
const HL_LABEL: Record<string, string> = { yellow: "Yellow", blue: "Blue", green: "Green" };

export type SetActions = {
  updateSet: (patch: Record<string, unknown>) => void;
  move: (dir: -1 | 1) => void;
  remove: () => void;
  addLine: () => void;
  updateLine: (line: SheetLine, patch: Record<string, unknown>) => void;
  moveLineUp: (index: number) => void;
  removeLine: (line: SheetLine) => void;
  newInstruction: (line: SheetLine) => void;
  link: (customerId: string) => void;
  unlink: (customerId: string) => void;
  fill: () => void;
};

export default function SetCard({
  set,
  index,
  count,
  week,
  cutSpecs,
  specMap,
  perLamb,
  sizes,
  products,
  customers,
  orders,
  orderingIds,
  title,
  act,
}: {
  set: SheetSet;
  index: number;
  count: number;
  week: string;
  cutSpecs: CutSpec[];
  specMap: Map<string, CutSpecLite>;
  perLamb: Record<string, number>;
  sizes: SizeClass[];
  products: CatalogProduct[];
  customers: CustomersData;
  orders: Map<string, { lines: Qty; units: Units }>;
  orderingIds: string[];
  /** "Parts 2A", or "The 40 XL set" for a set with no name. */
  title: string;
  act: SetActions;
}) {
  const counted = hasCountedLines(set);
  const chips = counted ? setBalance(set, specMap, perLamb) : [];
  const bad = chips.some((c) => !c.ok);

  const productById = new Map(products.map((p) => [p.id, p]));
  // Linked customers' orders this week, in each product's own unit.
  const totals: Qty = {};
  for (const cid of set.customers) {
    const o = orders.get(cid);
    if (!o) continue;
    const q = inProductUnits(o.lines, o.units, productById);
    for (const k in q) totals[k] = (totals[k] ?? 0) + q[k];
  }
  const ordered = products.filter((p) => (totals[p.id] ?? 0) > 0);
  const onSheet = ordered.filter((p) => p.links.length > 0);
  const notOnSheet = ordered.filter((p) => p.links.length === 0);
  const linkable = orderingIds.filter((id) => !set.customers.includes(id));

  return (
    <section className={`setcard ${bad ? "bad" : ""}`} aria-label={title}>
      <div className="sethead">
        <div className="sname">
          <label htmlFor={`sn-${set.id}`}>Set name or customer</label>
          <input
            id={`sn-${set.id}`}
            key={`n-${set.name}`}
            className="field"
            defaultValue={set.name}
            onBlur={(e) => e.target.value.trim() !== set.name && act.updateSet({ name: e.target.value.trim() })}
          />
        </div>
        <div>
          <label htmlFor={`sl-${set.id}`}>Lambs</label>
          <input
            id={`sl-${set.id}`}
            key={`l-${set.lambs}`}
            className="field num"
            inputMode="numeric"
            defaultValue={set.lambs || ""}
            onBlur={(e) => {
              const v = Math.max(0, Math.round(num(e.target.value)));
              if (v !== set.lambs) act.updateSet({ lambs: v });
            }}
          />
        </div>
        <div>
          <label htmlFor={`sz-${set.id}`}>Size</label>
          <select
            id={`sz-${set.id}`}
            className="field"
            value={set.size_class_id ?? ""}
            onChange={(e) => act.updateSet({ size_class_id: e.target.value || null })}
          >
            <option value="">Choose a size</option>
            {sizes.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label} ({z.weight_range})
              </option>
            ))}
          </select>
        </div>
        <div className="sbtns lopts">
          <button type="button" className="iconbtn" aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => act.move(-1)}>
            &#8593;
          </button>
          <button type="button" className="iconbtn" aria-label={`Move ${title} down`} disabled={index === count - 1} onClick={() => act.move(1)}>
            &#8595;
          </button>
          <button type="button" className="iconbtn text-barn" aria-label={`Delete ${title}`} onClick={act.remove}>
            &#10005;
          </button>
        </div>
      </div>

      <div className="setbody">
        <input
          key={`h-${set.headline}`}
          className="field mb-1.5"
          style={{ background: "#F2EA6255" }}
          aria-label="Yellow bar at the top of this set"
          placeholder="Yellow bar at the top of this set (optional)"
          defaultValue={set.headline}
          onBlur={(e) => e.target.value.trim() !== set.headline && act.updateSet({ headline: e.target.value.trim() })}
        />

        {set.lines.map((l, j) => (
          <LineRow
            key={l.id}
            line={l}
            index={j}
            cutSpecs={cutSpecs}
            specMap={specMap}
            onChange={(patch) => act.updateLine(l, patch)}
            onNew={() => act.newInstruction(l)}
            onUp={() => act.moveLineUp(j)}
            onDelete={() => act.removeLine(l)}
          />
        ))}

        <button type="button" className="btn ghost mt-2" onClick={act.addLine}>
          Add a line
        </button>

        {counted && (
          <div className="chips" aria-label="Does this set add up?">
            {chips.map((c) => (
              <span key={c.id} className={`chip ${c.ok ? "" : "bad"}`}>
                {chipText(c)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[.95rem]">
          <span>For:</span>
          {set.customers.map((cid) => {
            const c = customers.byId.get(cid);
            const name = c ? displayName(c, customers.byId) : "A customer";
            return (
              <span key={cid} className="chip inline-flex items-center gap-1">
                {name}
                <button type="button" className="copy min-h-[32px] px-1" aria-label={`Unlink ${name}`} onClick={() => act.unlink(cid)}>
                  ✕
                </button>
              </span>
            );
          })}
          <select
            className="field w-auto! min-h-[44px]"
            aria-label="Link a customer"
            value=""
            onChange={(e) => e.target.value && act.link(e.target.value)}
          >
            <option value="">Link a customer...</option>
            {linkable.map((id) => {
              const c = customers.byId.get(id)!;
              return (
                <option key={id} value={id}>
                  {displayName(c, customers.byId)}
                </option>
              );
            })}
          </select>
        </div>

        {set.customers.length > 0 && (
          <div className="mt-2 rounded-md bg-field p-2.5 text-[.95rem]">
            {ordered.length === 0 ? (
              <span className="muted">No orders entered this week for the linked customers.</span>
            ) : (
              <>
                <b>Their orders this week:</b>{" "}
                {ordered.map((p) => `${qtyText(totals[p.id], p.unit)} ${p.short_name || p.name}`).join("; ")}
                {notOnSheet.length > 0 && (
                  <div className="muted mt-1">
                    {notOnSheet.map((p) => p.name).join(" and ")}{" "}
                    {notOnSheet.length > 1 ? "aren't" : "isn't"} linked to a Mohawk line, so{" "}
                    {notOnSheet.length > 1 ? "they won't" : "it won't"} be added. Plan{" "}
                    {notOnSheet.length > 1 ? "them" : "it"} by hand (ground lamb goes in the grind set), or link{" "}
                    {notOnSheet.length > 1 ? "them" : "it"} in Setup.
                  </div>
                )}
                {onSheet.length > 0 &&
                  (set.filled_week === week ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <span>✓ Added to the lines above.</span>
                      <button type="button" className="copy min-h-[44px] text-[.9rem]" onClick={act.fill}>
                        Add them again
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <button type="button" className="btn" onClick={act.fill}>
                        Put these on this set
                      </button>
                      <span className="muted">Adds their counts to the lines above. Then the red counts show what&apos;s left to fill.</span>
                    </div>
                  ))}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function LineRow({
  line: l,
  index,
  cutSpecs,
  specMap,
  onChange,
  onNew,
  onUp,
  onDelete,
}: {
  line: SheetLine;
  index: number;
  cutSpecs: CutSpec[];
  specMap: Map<string, CutSpecLite>;
  onChange: (patch: Record<string, unknown>) => void;
  onNew: () => void;
  onUp: () => void;
  onDelete: () => void;
}) {
  const spec = l.cut_spec_id ? specMap.get(l.cut_spec_id) : undefined;
  const nextHl = HIGHLIGHTS[(HIGHLIGHTS.indexOf(l.highlight) + 1) % HIGHLIGHTS.length];
  // One-time wording: typed here, used on this set only. `once` keeps the
  // box open while it's still empty.
  const [once, setOnce] = useState(false);
  const oneTime = l.kind === "line" && !l.cut_spec_id && (once || !!(l.text ?? "").trim());
  const type = lineType(l, spec);
  const label = l.kind === "note" ? "Note" : (spec?.text ?? ((l.text ?? "").trim() || "Line"));

  return (
    <div className={`lrow ${l.highlight ? `hl-${l.highlight}` : ""}`}>
      {l.kind === "note" ? (
        <span className="small muted text-center">Note</span>
      ) : (
        <input
          key={`q-${l.qty}`}
          className="field num"
          inputMode="decimal"
          aria-label={`Count for ${label}`}
          defaultValue={l.qty == null ? "" : fmt(l.qty)}
          onBlur={(e) => {
            const t = e.target.value.trim();
            const v = t === "" ? null : Math.max(0, num(t));
            if (v !== l.qty) onChange({ qty: v });
          }}
        />
      )}

      <div className="flex min-w-0 flex-col gap-1">
        <select
          className="field"
          aria-label="Instruction"
          value={l.kind === "note" ? NOTE : oneTime ? ONCE : (l.cut_spec_id ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW) return onNew();
            setOnce(v === ONCE);
            if (v === NOTE)
              return onChange({ kind: "note", cut_spec_id: null, use_type: null, qty: null, text: l.text ?? "", shank_on: false });
            if (v === ONCE)
              return onChange({ kind: "line", cut_spec_id: null, use_type: l.use_type ?? "none", text: l.text ?? "", shank_on: false });
            if (v === "") return onChange({ kind: "line", cut_spec_id: null, use_type: null, text: null, shank_on: false });
            onChange({
              kind: "line",
              cut_spec_id: v,
              use_type: null,
              text: null,
              ...(specMap.get(v)?.use_type === "leg" ? {} : { shank_on: false }),
            });
          }}
        >
          <option value="">Choose an instruction...</option>
          {USE_GROUPS.map(([group, uses]) => {
            const list = cutSpecs.filter((s) => uses.includes(s.use_type as never) && (s.active || s.id === l.cut_spec_id));
            return list.length ? (
              <optgroup key={group} label={group}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.text}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
          <optgroup label="More">
            <option value={ONCE}>One-time instruction (this set only)...</option>
            <option value={NOTE}>Note line, no count</option>
            <option value={NEW}>Add a new instruction to the list...</option>
          </optgroup>
        </select>
        {l.kind === "note" && (
          <input
            key={`t-${l.text}`}
            className="field"
            aria-label="Note text"
            placeholder="What the note says"
            defaultValue={l.text ?? ""}
            onBlur={(e) => e.target.value !== (l.text ?? "") && onChange({ text: e.target.value })}
          />
        )}
        {oneTime && (
          <div className="flex flex-wrap gap-1">
            <input
              key={`o-${l.text}`}
              className="field min-w-[180px] flex-1"
              aria-label="One-time instruction"
              placeholder="Wording for Mohawk, this set only"
              autoFocus={once && !(l.text ?? "").trim()}
              defaultValue={l.text ?? ""}
              onBlur={(e) => e.target.value !== (l.text ?? "") && onChange({ text: e.target.value })}
            />
            <select
              className="field w-auto!"
              aria-label="What it counts as"
              value={l.use_type ?? "none"}
              onChange={(e) => onChange({ use_type: e.target.value, ...(e.target.value === "leg" ? {} : { shank_on: false }) })}
            >
              {USE_GROUPS.flatMap(([, uses]) => uses).map((u) => (
                <option key={u} value={u}>
                  Counts as: {USES[u].label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <input
        key={`s-${l.side_note}`}
        className="field side"
        aria-label={`Side note for ${label}`}
        placeholder="Side note"
        defaultValue={l.side_note}
        onBlur={(e) => e.target.value.trim() !== l.side_note && onChange({ side_note: e.target.value.trim() })}
      />

      <span className="lopts">
        {type === "leg" && (
          <label className="shank">
            <input
              type="checkbox"
              className="h-5 w-5 accent-forest"
              checked={l.shank_on}
              onChange={(e) => onChange({ shank_on: e.target.checked })}
            />
            shank on
          </label>
        )}
        <button
          type="button"
          className={`hlbtn ${l.highlight ?? ""}`}
          aria-label={`Highlight: ${l.highlight ? HL_LABEL[l.highlight] : "none"}. Change to ${nextHl ? HL_LABEL[nextHl] : "none"}`}
          title="Highlight color"
          onClick={() => onChange({ highlight: nextHl })}
        >
          {l.highlight ? "" : "Color"}
        </button>
        <button type="button" className="iconbtn" aria-label="Move line up" disabled={index === 0} onClick={onUp}>
          &#8593;
        </button>
        <button type="button" className="iconbtn text-barn" aria-label="Delete line" onClick={onDelete}>
          &#10005;
        </button>
      </span>
    </div>
  );
}
