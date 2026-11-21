"use client";

// P&L Setup: expense categories (Lucas, 11/16/26). One list in three groups
// (Cost of product, Delivery, Operating). Each category has a calculation
// method and rates with start dates: per lamb, percent of income (all income
// or sales only), fixed weekly (built from weekly and yearly parts), percent
// of other categories, carcass weights (producer pay), or entered by hand.
// Everything here is editable without code. Admins only.

import { Fragment, useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { centsText, factorText, parseRate, rateText } from "@/lib/calc/lambCost";
import {
  GROUPS,
  METHOD_LABEL,
  parseMoney,
  rateOn,
  weeklyFromParts,
  type CategoryMethod,
  type CategoryRate,
  type ExpenseCategory,
  type GroupName,
  type RatePart,
} from "@/lib/calc/pnl";
import { niceDate, packingMonday, todayISO, weekName } from "@/lib/dates";
import { deleteRate, loadClosedWeeks, loadPnlSetup, saveCategory, saveRate, type PnlSetup } from "@/lib/db/pnl";
import OwnersSetup from "./OwnersSetup";
import FreezerValueSetup from "./FreezerValueSetup";
import TruckDrivers from "./TruckDrivers";

const TABLES = ["expense_categories", "expense_category_rates"];
const dateText = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;
/** Methods that can be picked. */
const PICKABLE: CategoryMethod[] = [
  "entered",
  "per_lamb",
  "percent_income",
  "fixed_weekly",
  "percent_category",
  "per_truck_run",
  "freight_weight",
  "freight_pallet",
  "weigh_sheets",
];
const HAS_RATE: CategoryMethod[] = ["per_lamb", "percent_income", "fixed_weekly", "percent_category", "freight_weight", "freight_pallet"];
/** A category with rates: these methods, and truck maintenance (per run). */
const hasRate = (c: ExpenseCategory) => HAS_RATE.includes(c.method) || (c.method === "per_truck_run" && c.truck_part === "maintenance");
/** A typed amount that may be 0. */
const amountOk = (t: string) => (t.trim() === "" || Number(t) === 0 ? "0" : parseRate(t));

/** A rate in words: "$1.80 per lamb", "4%", "$110.46 a week". */
function rateWords(method: CategoryMethod, r: CategoryRate): string {
  if (method === "per_lamb") return `${rateText(r.amount ?? 0)} per lamb`;
  if (method === "per_truck_run") return `${rateText(r.amount ?? 0)} per run`;
  if (method === "freight_pallet") return `${rateText(r.amount ?? 0)} per pallet`;
  if (method === "freight_weight") {
    const box = Number(r.per_box_lb ?? 0);
    const pallet = Number(r.per_pallet_lb ?? 0);
    return `$${Number(r.amount ?? 0)} per lb${box || pallet ? ` (gross: + ${box} lb a box, + ${pallet} lb a pallet)` : ""}`;
  }
  if (method === "percent_income" || method === "percent_category") return `${factorText(r.percent ?? 0)}%`;
  if (method === "fixed_weekly") return `${centsText(weeklyFromParts(r.parts ?? []).cents)} a week`;
  return r.amount != null ? rateText(r.amount) : "";
}

export default function PnlSetupCards() {
  const load = useCallback((d: SupabaseClient) => loadPnlSetup(d), []);
  const { data, refresh, error } = useLive("pnl-setup", load, TABLES);
  const toast = useToast();
  if (error) return <p className="note bad mt-3">Couldn&apos;t load the expense categories: {error}</p>;
  if (!data) return <p className="small muted mt-3">Loading...</p>;
  const after = (err: string | null, ok: string) => {
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
    return !err;
  };
  return (
    <>
      <Categories data={data} after={after} />
      <FreezerValueSetup />
      <TruckDrivers />
      <OwnersSetup />
    </>
  );
}

type After = (err: string | null, ok: string) => boolean;

function Categories({ data, after }: { data: PnlSetup; after: After }) {
  const db = getDb();
  const thisWeek = packingMonday(todayISO());
  const [name, setName] = useState("");
  const [group, setGroup] = useState<GroupName>("Operating");
  const [method, setMethod] = useState<CategoryMethod>("entered");
  const ordered = [...data.categories].sort((a, b) => GROUPS.indexOf(a.group_name) - GROUPS.indexOf(b.group_name) || a.sort - b.sort || a.name.localeCompare(b.name));

  const add = async () => {
    if (!name.trim()) return;
    const sort = data.categories.filter((c) => c.group_name === group).reduce((m, c) => Math.max(m, c.sort), (GROUPS.indexOf(group) + 1) * 100) + 10;
    if (after(await saveCategory(db, { name, group_name: group, method, active: true, sort }), `Added ${name.trim()}`)) setName("");
  };

  return (
    <section className="panel mt-3" aria-labelledby="pnl-cats">
      <h3 id="pnl-cats">Expense categories</h3>
      <p className="small muted mt-1">
        Every expense on the weekly P&amp;L, in three groups. Each category is worked out by its method, with rates that apply
        from a start date on. Tap one to change it. Retire one you no longer use; its past weeks still show it.
      </p>
      {GROUPS.map((g) => (
        <Fragment key={g}>
          <h4 className="mb-1 mt-3">{g}</h4>
          <ul className="m-0 list-none p-0">
            {ordered
              .filter((c) => c.group_name === g)
              .map((c) => (
                <CategoryRow key={c.id} c={c} data={data} thisWeek={thisWeek} after={after} />
              ))}
          </ul>
        </Fragment>
      ))}
      <form
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="grid min-w-[12rem] flex-1 gap-1">
          <span className="lbl m-0">New category</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Group</span>
          <select className="field" value={group} onChange={(e) => setGroup(e.target.value as GroupName)}>
            {GROUPS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Method</span>
          <select className="field" value={method} onChange={(e) => setMethod(e.target.value as CategoryMethod)}>
            {PICKABLE.filter((m) => m !== "weigh_sheets").map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn ghost" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

function CategoryRow({ c, data, thisWeek, after }: { c: ExpenseCategory; data: PnlSetup; thisWeek: string; after: After }) {
  const now = rateOn(data.rates, c.id, thisWeek);
  const rates = data.rates.filter((r) => r.category_id === c.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const summary = [
    METHOD_LABEL[c.method],
    c.method === "percent_income" ? (c.income_base === "sales" ? "of sales" : "of all income") : "",
    hasRate(c) ? (now ? `this week ${rateWords(c.method, now)}` : "no rate this week") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="border-t border-line py-1.5">
      <details>
        <summary className="cursor-pointer">
          <b className={c.active ? "" : "muted"}>{c.name}</b>
          {!c.active && <span className="tag ml-2">Retired</span>}
          <span className="small muted"> · {summary}</span>
        </summary>
        <div className="mt-2 grid gap-3 pl-4">
          <CategoryForm c={c} data={data} after={after} />
          {hasRate(c) && <Rates c={c} rates={rates} now={now} after={after} />}
          {c.method === "weigh_sheets" && (
            <p className="small m-0">The rate and live factor are under Pricing and the producers above; each carcass weights sheet keeps its own.</p>
          )}
          {c.method === "entered" && <p className="small m-0">Amounts are typed in on the Weekly P&amp;L, with a photo or PDF if wanted.</p>}
        </div>
      </details>
    </li>
  );
}

function CategoryForm({ c, data, after }: { c: ExpenseCategory; data: PnlSetup; after: After }) {
  const db = getDb();
  const [name, setName] = useState(c.name);
  const [group, setGroup] = useState<GroupName>(c.group_name);
  const [method, setMethod] = useState<CategoryMethod>(c.method);
  const [base, setBase] = useState<"all" | "sales">(c.income_base);
  const [of, setOf] = useState<string[]>(c.base_category_ids);
  const [sort, setSort] = useState(String(c.sort));
  const [part, setPart] = useState(c.truck_part ?? "driver_pay");
  const [kind, setKind] = useState(c.delivery_kind ?? "");
  const [carrier, setCarrier] = useState(c.carrier ?? "");
  const [ids, setIds] = useState<string[]>(c.customer_ids ?? []);
  const [basis, setBasis] = useState<"gross" | "net">(c.weight_basis ?? "gross");
  const { customers } = useStaffData();
  const isFreight = method === "freight_weight" || method === "freight_pallet";
  // Chains (customers with locations) and every location, for what a carrier covers.
  const chainIds = new Set((customers?.list ?? []).map((x) => x.parent_customer_id).filter(Boolean) as string[]);
  const choices = customers
    ? sortByDisplayName(
        customers.list.filter((x) => x.active || ids.includes(x.id)),
        customers.byId,
      ).map((x) => ({ id: x.id, label: chainIds.has(x.id) ? `${x.name} (all its stores)` : displayName(x, customers.byId), chain: chainIds.has(x.id) }))
    : [];
  const methods = PICKABLE.includes(c.method) ? PICKABLE : [c.method, ...PICKABLE];
  const others = data.categories.filter((x) => x.id !== c.id && x.method !== "percent_category");

  const save = async () => {
    if (!name.trim()) return;
    after(
      await saveCategory(db, {
        id: c.id,
        name,
        group_name: group,
        method,
        income_base: base,
        base_category_ids: method === "percent_category" ? of : c.base_category_ids,
        sort: Number.isFinite(Number(sort)) ? Math.round(Number(sort)) : c.sort,
        truck_part: method === "per_truck_run" ? (part as "driver_pay" | "fuel" | "maintenance") : null,
        delivery_kind: group === "Delivery" && kind ? (kind as "truck" | "freight") : null,
        carrier: carrier.trim(),
        customer_ids: ids,
        weight_basis: basis,
      }),
      `Saved ${name.trim()}`,
    );
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-[12rem] flex-1 gap-1">
          <span className="lbl m-0">Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Group</span>
          <select className="field" value={group} onChange={(e) => setGroup(e.target.value as GroupName)}>
            {GROUPS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Method</span>
          <select className="field" value={method} onChange={(e) => setMethod(e.target.value as CategoryMethod)}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Order</span>
          <input className="field num w-20!" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
        </label>
      </div>
      {isFreight && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[10rem] gap-1">
              <span className="lbl m-0">Carrier</span>
              <input className="field" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </label>
            {method === "freight_weight" && (
              <label className="grid gap-1">
                <span className="lbl m-0">Weight</span>
                <select className="field" value={basis} onChange={(e) => setBasis(e.target.value as "gross" | "net")}>
                  <option value="gross">Gross: meat + lb per box + lb per pallet (set with the rate)</option>
                  <option value="net">Net: the boxes&apos; meat weight only</option>
                </select>
              </label>
            )}
          </div>
          <fieldset className="m-0 border-0 p-0">
            <legend className="lbl m-0">Locations it carries (a chain covers all its stores)</legend>
            <div className="flex flex-wrap gap-x-4">
              {choices.map((x) => (
                <label key={x.id} className={`flex min-h-[44px] items-center gap-2 ${x.chain ? "font-semibold" : ""}`}>
                  <input type="checkbox" checked={ids.includes(x.id)} onChange={(e) => setIds(e.target.checked ? [...ids, x.id] : ids.filter((id) => id !== x.id))} />
                  {x.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
      {(method === "per_truck_run" || group === "Delivery") && (
        <div className="flex flex-wrap items-end gap-2">
          {method === "per_truck_run" && (
            <label className="grid gap-1">
              <span className="lbl m-0">From each run</span>
              <select className="field" value={part} onChange={(e) => setPart(e.target.value as "driver_pay" | "fuel" | "maintenance")}>
                <option value="driver_pay">Driver pay (the driver&apos;s rates, below)</option>
                <option value="fuel">Fuel (entered on the run)</option>
                <option value="maintenance">Maintenance (rate per run, drivers with it on)</option>
              </select>
            </label>
          )}
          {group === "Delivery" && (
            <label className="grid gap-1">
              <span className="lbl m-0">Truck or freight</span>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="truck">Our truck (counts toward cost per stop)</option>
                <option value="freight">Freight (carriers)</option>
                <option value="">Neither</option>
              </select>
            </label>
          )}
        </div>
      )}
      {method === "percent_income" && (
        <label className="grid gap-1">
          <span className="lbl m-0">Percent of</span>
          <select className="field max-w-[20rem]" value={base} onChange={(e) => setBase(e.target.value as "all" | "sales")}>
            <option value="all">All income (invoices, other income, adjustments)</option>
            <option value="sales">Sales only (invoices)</option>
          </select>
        </label>
      )}
      {method === "percent_category" && (
        <fieldset className="m-0 border-0 p-0">
          <legend className="lbl m-0">Percent of these categories</legend>
          <div className="flex flex-wrap gap-x-4">
            {others.map((x) => (
              <label key={x.id} className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" checked={of.includes(x.id)} onChange={(e) => setOf(e.target.checked ? [...of, x.id] : of.filter((id) => id !== x.id))} />
                {x.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn ghost" disabled={!name.trim()}>
          Save
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void saveCategory(db, { id: c.id, active: !c.active }).then((err) => after(err, c.active ? `${c.name} retired` : `${c.name} back in use`))}
        >
          {c.active ? "Retire" : "Use again"}
        </button>
      </div>
    </form>
  );
}

/** A category's rates, newest first, and a form to add one from a date. */
function Rates({ c, rates, now, after }: { c: ExpenseCategory; rates: CategoryRate[]; now: CategoryRate | null; after: After }) {
  const db = getDb();
  const toast = useToast();
  const [from, setFrom] = useState(todayISO());
  const [value, setValue] = useState("");
  const [boxLb, setBoxLb] = useState(now?.per_box_lb != null ? String(Number(now.per_box_lb)) : "0");
  const [palletLb, setPalletLb] = useState(now?.per_pallet_lb != null ? String(Number(now.per_pallet_lb)) : "0");
  const [note, setNote] = useState("");
  const [parts, setParts] = useState<{ label: string; amount: string; per: "week" | "year" }[]>(
    (now?.parts ?? []).map((q) => ({ label: q.label, amount: String(q.amount), per: q.per })),
  );
  const fixed = c.method === "fixed_weekly";
  const isPercent = c.method === "percent_income" || c.method === "percent_category";

  const add = async () => {
    let amount: string | null = null;
    let percent: string | null = null;
    let list: RatePart[] = [];
    if (fixed) {
      const bad = parts.find((q) => parseMoney(q.amount) == null);
      if (!parts.length || bad) return toast("Type each amount like 60.00");
      list = parts.map((q) => ({ label: q.label.trim() || (q.per === "week" ? "Weekly amount" : "Yearly amount"), amount: Number(parseMoney(q.amount)), per: q.per }));
    } else {
      const v = parseRate(value);
      if (v == null) return toast(isPercent ? "Type the percent like 4" : "Type the amount like 1.80");
      if (isPercent && Number(v) > 100) return toast("A percent is from 0 to 100");
      if (isPercent) percent = v;
      else amount = v;
    }
    // A rate reaching back into a week closed on the Weekly P&L: say so first.
    const closed = (await loadClosedWeeks(db)).filter((w) => w >= packingMonday(from)).sort();
    if (
      closed.length &&
      !confirm(
        `This rate starts ${niceDate(from)}, which reaches back into ${closed.length === 1 ? "a week" : "weeks"} closed on the Weekly P&L: ${closed.map(weekName).join(", ")}.\n\nA closed week's P&L stays as it was when closed. Save anyway?`,
      )
    )
      return;
    if (after(await saveRate(db, {
          categoryId: c.id,
          from,
          amount,
          percent,
          parts: list,
          note,
          ...(c.method === "freight_weight" ? { perBoxLb: amountOk(boxLb), perPalletLb: amountOk(palletLb) } : {}),
        }), `Saved from ${niceDate(from)}`)) {
      setValue("");
      setNote("");
    }
  };
  const remove = async (r: CategoryRate) => {
    if (!confirm(`Delete the ${rateWords(c.method, r)} rate starting ${dateText(r.effective_from)}?`)) return;
    after(await deleteRate(db, r.id), "Deleted");
  };
  const preview = fixed && parts.every((q) => parseMoney(q.amount) != null) ? weeklyFromParts(parts.map((q) => ({ ...q, amount: Number(parseMoney(q.amount)) }))) : null;

  return (
    <div>
      <div className="lbl m-0">Rates</div>
      {rates.length === 0 && <p className="small m-0">None yet.</p>}
      <ul className="small m-0 list-none p-0">
        {rates.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3">
            <span className="num">{rateWords(c.method, r)}</span>
            <span className="muted">from {dateText(r.effective_from)}</span>
            {fixed && (
              <span className="muted">
                ({(r.parts ?? []).map((q) => `${q.label} ${centsText(BigInt(Math.round(Number(q.amount) * 100)))}${q.per === "year" ? " a year ÷ 52" : " a week"}`).join(" + ")})
              </span>
            )}
            {r.note && <span className="muted">{r.note}</span>}
            <button type="button" className="copy min-h-[44px] px-2" onClick={() => void remove(r)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 grid gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        {fixed && (
          <div className="grid gap-1">
            <span className="lbl m-0">Parts</span>
            {parts.map((q, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  className="field min-w-[10rem] flex-1"
                  aria-label="What it is"
                  value={q.label}
                  onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <input
                  className="field num w-28!"
                  aria-label="Amount"
                  inputMode="decimal"
                  value={q.amount}
                  onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                />
                <select className="field" aria-label="Each week or year" value={q.per} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, per: e.target.value as "week" | "year" } : x)))}>
                  <option value="week">a week</option>
                  <option value="year">a year (÷ 52)</option>
                </select>
                <button type="button" className="copy min-h-[44px] px-2" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="copy min-h-[44px] px-2" onClick={() => setParts([...parts, { label: "", amount: "", per: "week" }])}>
                Add a part
              </button>
              {preview && <span className="small">= {centsText(preview.cents)} a week</span>}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="lbl m-0">Starts on</span>
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          {!fixed && (
            <label className="grid gap-1">
              <span className="lbl m-0">
                {isPercent
                  ? "Percent"
                  : c.method === "per_truck_run"
                    ? "$ per run"
                    : c.method === "freight_weight"
                      ? "$ per lb"
                      : c.method === "freight_pallet"
                        ? "$ per pallet"
                        : "$ per lamb"}
              </span>
              <input className="field num w-24!" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
          {c.method === "freight_weight" && (
            <>
              <label className="grid gap-1">
                <span className="lbl m-0">+ lb a box (gross)</span>
                <input className="field num w-20!" inputMode="decimal" value={boxLb} onChange={(e) => setBoxLb(e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="lbl m-0">+ lb a pallet (gross)</span>
                <input className="field num w-20!" inputMode="decimal" value={palletLb} onChange={(e) => setPalletLb(e.target.value)} />
              </label>
            </>
          )}
          <label className="grid min-w-[8rem] flex-1 gap-1">
            <span className="lbl m-0">Note (optional)</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn ghost" disabled={!fixed && !value.trim()}>
            Add rate
          </button>
        </div>
        <p className="small muted m-0">A rate applies from its start date on. A rate on the same start date replaces it. To stop, add 0 from a date.</p>
      </form>
    </div>
  );
}
