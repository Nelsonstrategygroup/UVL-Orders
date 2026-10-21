"use client";

// Setup: how much of each product fits in each box type (SPEC 12.2), and the
// box cap. Cells Kathy still needs to check stand out, with the note on tap.
// Everyone with Setup can look; admins change.

import { useState } from "react";
import { useStaffData, getDb } from "@/components/data/StaffData";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { boxCapacity, type BoxLimit, type BoxType } from "@/lib/calc/boxes";
import { fmt, num } from "@/lib/calc/num";
import { groupProducts } from "@/lib/calc/products";
import { unitWord } from "@/lib/calc/units";
import { saveBoxCap, saveBoxLimit } from "@/lib/db/boxes";
import type { CatalogProduct } from "@/lib/db/types";

type Cell = BoxLimit & { note?: string };

function cellText(c: Cell | undefined, p: CatalogProduct): string {
  if (!c) return "";
  if (c.status === "does_not_fit") return "—";
  if (c.status === "needs_checking") return "Check";
  const parts: string[] = [];
  if (c.max_count != null) parts.push(p.unit === "lb" ? `${fmt(c.max_count)} lb` : fmt(c.max_count));
  if (c.max_lb != null) parts.push(`${fmt(c.max_lb)} lb`);
  return parts.join(" · ");
}

export default function BoxLimits({ canEdit }: { canEdit: boolean }) {
  const { catalog, reloadCatalog } = useStaffData();
  const toast = useToast();
  const [open, setOpen] = useState<{ product: CatalogProduct; type: BoxType } | null>(null);
  if (!catalog) return null;
  const { types, limits, capLb } = catalog.boxes;
  const products = catalog.products.filter((p) => p.active);
  const cell = (pid: string, tid: string) => limits.get(pid)?.find((l) => l.box_type_id === tid) as Cell | undefined;
  const toCheck = products.reduce((n, p) => n + (limits.get(p.id) ?? []).filter((l) => l.status === "needs_checking").length, 0);
  // No confirmed box, leaving out products that never go in a box on purpose.
  const none = products.filter((p) => {
    const ls = limits.get(p.id) ?? [];
    return !ls.some((l) => l.status === "ok") && !(ls.length && ls.every((l) => l.status === "does_not_fit"));
  });

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="lbl m-0">No box over (lb)</span>
          <input
            key={capLb}
            className="field num w-[8ch]"
            inputMode="decimal"
            defaultValue={fmt(capLb)}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = num(e.target.value);
              if (v > 0 && v !== capLb)
                void saveBoxCap(getDb(), v).then(async (err) => {
                  if (err) toast(`Couldn't save: ${err}`);
                  await reloadCatalog();
                });
            }}
          />
        </label>
        <p className="small muted m-0 flex-1">
          A box&apos;s limit is the lowest of its count, its pounds, and this cap. Counts are in the product&apos;s unit.
          {toCheck > 0 && (
            <>
              {" "}
              <span className="boxcell check inline-block px-1">Check</span> = {toCheck} boxes Kathy still needs to confirm;
              tap one to see the note.
            </>
          )}
        </p>
      </div>
      {none.length > 0 && <p className="note bad small mt-2">No confirmed box for: {none.map((p) => p.name).join(", ")}.</p>}

      <div className="mt-3 overflow-x-auto">
        <table className="simple boxgrid">
          <thead>
            <tr>
              <th>Product</th>
              {types.map((t) => (
                <th key={t.id} className="text-center">
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          {groupProducts(products).map((g) => (
            <tbody key={g.group}>
              <tr className="grp">
                <th colSpan={types.length + 1}>{g.group}</th>
              </tr>
              {g.products.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name} <span className="small muted">{unitWord(p.unit)}</span>
                  </td>
                  {types.map((t) => {
                    const c = cell(p.id, t.id);
                    return (
                      <td key={t.id} className="text-center">
                        <button
                          type="button"
                          className={`boxcell ${c?.status === "needs_checking" ? "check" : c?.status === "does_not_fit" ? "no" : ""}`}
                          title={c?.note || undefined}
                          aria-label={`${p.name} in a ${t.name} box: ${cellText(c, p) || "not set"}`}
                          onClick={() => setOpen({ product: p, type: t })}
                        >
                          {cellText(c, p) || "·"}
                          {c?.note ? <span className="dot" aria-hidden="true" /> : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {open && (
        <EditCell
          product={open.product}
          type={open.type}
          cell={cell(open.product.id, open.type.id)}
          capLb={capLb}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onSaved={async (err) => {
            if (err) return toast(`Couldn't save: ${err}`);
            toast("Saved");
            setOpen(null);
            await reloadCatalog();
          }}
        />
      )}
    </>
  );
}

function EditCell({
  product: p,
  type,
  cell,
  capLb,
  canEdit,
  onClose,
  onSaved,
}: {
  product: CatalogProduct;
  type: BoxType;
  cell: Cell | undefined;
  capLb: number;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (err: string | null) => Promise<void> | void;
}) {
  const [status, setStatus] = useState<BoxLimit["status"]>(cell?.status ?? "ok");
  const [count, setCount] = useState(cell?.max_count != null ? fmt(cell.max_count) : "");
  const [lb, setLb] = useState(cell?.max_lb != null ? fmt(cell.max_lb) : "");
  const [note, setNote] = useState(cell?.note ?? "");
  const unit = unitWord(p.unit);
  const draft: BoxLimit = {
    box_type_id: type.id,
    status,
    max_count: num(count) > 0 ? num(count) : null,
    max_lb: num(lb) > 0 ? num(lb) : null,
  };
  const holds = status === "ok" ? boxCapacity(draft, p, capLb) : null;
  const ok = status !== "ok" || draft.max_count != null || draft.max_lb != null;

  return (
    <Sheet title={`${p.name} in a ${type.name} box`} onClose={onClose}>
      {cell?.note && <p className="note small">{cell.note}</p>}
      <fieldset disabled={!canEdit} className="m-0 border-0 p-0">
        <div className="seg my-2" role="group" aria-label="Does it go in this box?">
          {(
            [
              ["ok", "Fits"],
              ["does_not_fit", "Never goes in it"],
              ["needs_checking", "Needs checking"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}>
              {label}
            </button>
          ))}
        </div>
        {status === "ok" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="lbl m-0">Most {p.unit === "lb" ? "lb" : unit} in one box</span>
              <input className="field num" inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label className="grid gap-1">
              <span className="lbl m-0">Most pounds in one box</span>
              <input className="field num" inputMode="decimal" value={lb} onChange={(e) => setLb(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
          </div>
        )}
        {status === "ok" && (
          <p className="small muted mt-2 mb-0">
            {holds != null
              ? `A ${type.name} box holds ${p.unit === "lb" ? `${fmt(holds)} lb` : `${fmt(holds)} ${unitWord(p.unit, holds)}`} (no box over ${fmt(capLb)} lb).`
              : draft.max_lb != null && !p.lb_per_unit && p.unit !== "lb"
                ? `Add a weight per ${unitWord(p.unit, 1)} on the product to use a pound limit.`
                : "Enter a count, pounds, or both."}
            {p.unit !== "lb" && !p.lb_per_unit && draft.max_count != null && " The weight can't be checked without a weight per unit."}
          </p>
        )}
        <label className="lbl" htmlFor="bx-note">
          Note
        </label>
        <input id="bx-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      </fieldset>
      <div className="mt-4 flex gap-2">
        {canEdit && (
          <button
            type="button"
            className="btn"
            disabled={!ok}
            onClick={() =>
              void saveBoxLimit(getDb(), {
                product_id: p.id,
                box_type_id: type.id,
                status,
                max_count: status === "ok" ? draft.max_count : null,
                max_lb: status === "ok" ? draft.max_lb : null,
                note: note.trim(),
              }).then(onSaved)
            }
          >
            Save
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onClose}>
          {canEdit ? "Cancel" : "Close"}
        </button>
      </div>
    </Sheet>
  );
}
