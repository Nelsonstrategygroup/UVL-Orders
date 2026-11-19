"use client";

// One carcass weights sheet (SPEC 16.3-16.4; renamed 11/17/26): one producer and kill
// date of Mohawk's carcass weights. The grid matches the paper: columns of 20
// rows, a heavier line after row 10. Type a weight, press Enter, and the
// cursor moves down, then to the top of the next column. Every change is in
// the audit log. Pay is shown step by step; only the total is rounded.

import { useCan } from "@/components/CurrentUser";
import ViewOnly from "@/components/ViewOnly";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { useWeek } from "@/components/Week";
import {
  ADJUSTMENT_REASONS,
  carcassText,
  centsText,
  factorText,
  fixedRounded,
  GRID_ROWS,
  liveText,
  moneyText,
  parseCarcass,
  parseFactor,
  parseRate,
  rateFor,
  rateOriginText,
  rateText,
  REASON_LABEL,
  sheetPay,
  sizeFor,
  type AdjustmentKind,
  type AdjustmentReason,
  type KillAdjustment,
  type KillLamb,
  type KillSheet,
  type SheetPay,
  type SizeClass,
} from "@/lib/calc/lambCost";
import { longDate, weekName } from "@/lib/dates";
import { loadLambCostSetup, type LambCostSetup } from "@/lib/db/lambCost";
import {
  addAdjustment,
  addSheetPhoto,
  deleteAdjustment,
  deleteSheet,
  deleteSheetPhoto,
  deleteWeight,
  loadSheet,
  photoLinks,
  setWeight,
  updateSheet,
  applySetupRates,
  setSheetOverride,
  weekIsClosed,
  type KillSheetPhoto,
} from "@/lib/db/weighSheets";

const TABLES = ["kill_sheets", "kill_lambs", "kill_adjustments", "kill_sheet_photos"];

export default function SheetScreen({ id }: { id: string }) {
  const canEdit = useCan("carcass").change;
  const { catalog } = useStaffData();
  const load = useCallback((d: SupabaseClient) => loadSheet(d, id), [id]);
  const { data, error, refresh } = useLive(`kill-sheet:${id}`, load, TABLES);
  const loadSetup = useCallback((d: SupabaseClient) => loadLambCostSetup(d), []);
  const { data: setup } = useLive("lamb-cost-setup", loadSetup, ["producers", "lamb_cost_settings", "producer_rates"]);
  const { setWeek } = useWeek();

  if (error) return <p className="note bad">Couldn&apos;t load the sheet: {error}</p>;
  if (!data || !setup || !catalog) return <p className="small muted">Loading...</p>;
  const sheet = data.sheets[0];
  if (!sheet)
    return (
      <p className="note">
        This sheet is gone. <Link href="/carcass-weights">Back to carcass weights</Link>
      </p>
    );

  const pay = sheetPay(sheet, data.lambs, data.adjustments);
  const producer = setup.producers.find((p) => p.id === sheet.producer_id);

  return (
    <div className="max-w-[960px]">
      <Link href="/carcass-weights" className="copy" onClick={() => setWeek(sheet.week_id)}>
        &larr; Carcass weights, {weekName(sheet.week_id)}
      </Link>
      <h2 className="mt-1 mb-0">{producer?.name ?? "Unknown producer"}</h2>
      <p className="mt-0 mb-2 muted">
        Killed {longDate(sheet.kill_date)}
        {producer?.ranch_name ? ` · ${producer.ranch_name}` : ""}
      </p>

      {!canEdit && <ViewOnly what="these carcass weights" />}
      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
        <Grid sheet={sheet} lambs={data.lambs} adjustments={data.adjustments} sizes={catalog.sizes} refresh={refresh} />
      </fieldset>
      <PaySteps pay={pay} sizes={catalog.sizes} />
      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
        <Adjustments sheet={sheet} pay={pay} refresh={refresh} />
      </fieldset>
      <Photos sheetId={sheet.id} photos={data.photos} refresh={refresh} />
      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
        <Details sheet={sheet} setup={setup} photoPaths={data.photos.map((p) => p.path)} lambs={pay.count} refresh={refresh} />
      </fieldset>
    </div>
  );
}

// ----- The entry grid -----

function Grid({
  sheet,
  lambs,
  adjustments,
  sizes,
  refresh,
}: {
  sheet: KillSheet;
  lambs: KillLamb[];
  adjustments: KillAdjustment[];
  sizes: SizeClass[];
  refresh: () => void;
}) {
  const db = getDb();
  const toast = useToast();
  const mine = lambs.filter((l) => l.sheet_id === sheet.id);
  const byPos = new Map(mine.map((l) => [l.position, l]));
  const maxPos = mine.reduce((m, l) => Math.max(m, l.position), 0);
  // Always room for the next lamb: a new column opens after row 20.
  const [minColumns, setMinColumns] = useState(1);
  const columns = Math.max(minColumns, Math.ceil((maxPos + 1) / GRID_ROWS));
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const [focusNext, setFocusNext] = useState<number | null>(null);
  // What each place last held, so Enter then leaving the box doesn't save twice.
  const saving = useRef(new Set<number>());
  const total = mine.reduce((s, l) => s + BigInt(Math.round(Number(l.carcass_lb) * 100)), BigInt(0));

  useEffect(() => {
    if (focusNext == null) return;
    const el = inputs.current.get(focusNext);
    if (el) {
      el.focus();
      el.select();
      setFocusNext(null);
    }
  }, [focusNext, columns, lambs]);

  const commit = async (position: number, el: HTMLInputElement): Promise<boolean> => {
    const text = el.value.trim();
    const lamb = byPos.get(position);
    if (saving.current.has(position)) return true;
    if (!text) {
      if (!lamb) return true;
      saving.current.add(position);
      const err = await deleteWeight(db, lamb.id);
      saving.current.delete(position);
      if (err) {
        el.value = String(Number(lamb.carcass_lb));
        toast(`Couldn't remove it: ${err}`);
        return false;
      }
      toast(`Removed lamb ${position} (${Number(lamb.carcass_lb)} lb)`);
      refresh();
      return true;
    }
    const v = parseCarcass(text);
    if (v == null) {
      toast("Type a weight like 62.4");
      return false;
    }
    if (lamb && Number(lamb.carcass_lb) === Number(v)) return true;
    saving.current.add(position);
    const err = await setWeight(db, sheet.id, position, v);
    saving.current.delete(position);
    if (err) {
      toast(`Couldn't save lamb ${position}: ${err}`);
      return false;
    }
    refresh();
    return true;
  };

  const adjusted = new Set(adjustments.filter((a) => a.lamb_id).map((a) => a.lamb_id));

  return (
    <section className="panel" aria-labelledby="ws-grid">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 id="ws-grid">Carcass weights</h3>
        <p className="m-0 text-[1.1rem]" role="status" aria-live="polite">
          <b className="num">{mine.length}</b> lambs · <b className="num">{carcassText(total)}</b> lb
        </p>
      </div>
      <p className="small muted mt-1">
        Type each weight and press Enter. Columns of 20, like the paper. To remove a weight, clear it and press Enter.
      </p>
      <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: columns }, (_, c) => (
          <table key={c} className="shrink-0 border-collapse" aria-label={`Column ${c + 1}`}>
            <tbody>
              {Array.from({ length: GRID_ROWS }, (_, r) => {
                const position = c * GRID_ROWS + r + 1;
                const lamb = byPos.get(position);
                const size = lamb ? sizeFor(Number(lamb.carcass_lb), sizes) : null;
                return (
                  <tr key={position} style={r === 9 ? { borderBottom: "3px solid var(--ink)" } : { borderBottom: "1px solid var(--line, #ccc)" }}>
                    <td className="num w-8 pr-1 text-right text-[.85rem] text-ink-soft">{position}</td>
                    <td className="py-0.5">
                      <input
                        key={`${position}:${lamb?.id ?? ""}:${lamb?.carcass_lb ?? ""}`}
                        ref={(el) => {
                          if (el) inputs.current.set(position, el);
                          else inputs.current.delete(position);
                        }}
                        className="field num w-[5.5rem]! py-1!"
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        aria-label={`Lamb ${position}, carcass lb`}
                        defaultValue={lamb ? String(Number(lamb.carcass_lb)) : ""}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const el = e.currentTarget;
                          // Check the weight now, but don't wait for the save: the cursor
                          // moves at once so fast typing never lands in the wrong box.
                          const text = el.value.trim();
                          if (text && parseCarcass(text) == null) {
                            toast("Type a weight like 62.4");
                            return el.select();
                          }
                          void commit(position, el);
                          const next = inputs.current.get(position + 1);
                          if (next) {
                            next.focus();
                            next.select();
                          } else {
                            setMinColumns(Math.ceil((position + 1) / GRID_ROWS));
                            setFocusNext(position + 1);
                          }
                        }}
                        onBlur={(e) => void commit(position, e.currentTarget)}
                      />
                    </td>
                    <td className="w-20 pl-1 text-[.8rem] text-ink-soft">
                      {lamb ? (size ? size.label : "Unassigned") : ""}
                      {lamb && adjusted.has(lamb.id) ? " ±" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
      <p className="small muted mt-1 mb-0">
        Size is from Setup &gt; Lamb sizes. &quot;Unassigned&quot; means the weight is in no size, or in two sizes that
        overlap. ± means the lamb has an adjustment.
      </p>
    </section>
  );
}

// ----- Pay, step by step -----

function PaySteps({ pay, sizes }: { pay: SheetPay; sizes: SizeClass[] }) {
  const s = pay.sheet;
  const rateWord = s.rate_source === "override" ? "override" : s.rate_source === "producer" ? "this producer's own rate" : "base rate";
  return (
    <section className="panel mt-3" aria-labelledby="ws-pay">
      <h3 id="ws-pay">Pay</h3>
      {pay.count === 0 ? (
        <p className="small muted mt-1 mb-0">No weights yet.</p>
      ) : (
        <>
          <table className="simple mt-1">
            <tbody>
              <tr>
                <td>Carcass lb &times; live weight factor</td>
                <td className="num text-right whitespace-nowrap">
                  {carcassText(pay.carcass)} &times; {factorText(s.live_factor)} = <b>{liveText(pay.live)}</b> live lb
                </td>
              </tr>
              <tr>
                <td>Live lb &times; rate ({rateWord})</td>
                <td className="num text-right whitespace-nowrap">
                  {liveText(pay.live)} &times; {rateText(s.base_rate)} = <b>{moneyText(pay.base)}</b>
                </td>
              </tr>
              {pay.lambAdjustments !== BigInt(0) && (
                <tr>
                  <td>Adjustments on single lambs</td>
                  <td className="num text-right">{signed(pay.lambAdjustments)}</td>
                </tr>
              )}
              {pay.sheetAdjustments.map(({ adj, money }) => (
                <tr key={adj.id}>
                  <td>
                    {REASON_LABEL[adj.reason]} on the whole sheet
                    {adj.kind === "per_live_lb" ? ` (${perLb(adj.amount)} × ${liveText(pay.live)} live lb)` : ""}
                    {adj.note ? <span className="small muted"> · {adj.note}</span> : null}
                  </td>
                  <td className="num text-right">{signed(money)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td>Pay for this sheet</td>
                <td className="num text-right text-[1.15rem]">{centsText(pay.cents)}</td>
              </tr>
            </tbody>
          </table>
          <p className="small muted mt-2 mb-0">
            The rate and factor were stored on this sheet, so a later change in Setup doesn&apos;t change it. Each lamb is
            worked out exactly; only this total is rounded to the cent.
          </p>
          <details className="mt-2">
            <summary className="copy">Each lamb, step by step ({pay.count})</summary>
            <div className="overflow-x-auto">
              <table className="simple mt-1">
                <thead>
                  <tr>
                    <th className="text-right">Lamb</th>
                    <th>Size</th>
                    <th className="text-right">Carcass lb</th>
                    <th className="text-right">&times; {factorText(s.live_factor)} = live lb</th>
                    <th className="text-right">&times; {rateText(s.base_rate)} = base pay</th>
                    <th className="text-right">Adjustments</th>
                    <th className="text-right">Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {pay.lambs.map((l) => {
                    const size = sizeFor(Number(l.lamb.carcass_lb), sizes);
                    const adj = l.pay - l.base;
                    return (
                      <tr key={l.lamb.id}>
                        <td className="num text-right">{l.lamb.position}</td>
                        <td>{size ? size.label : <span className="muted">Unassigned</span>}</td>
                        <td className="num text-right">{carcassText(l.carcass)}</td>
                        <td className="num text-right">{fixedRounded(l.live, 6, 3)}</td>
                        <td className="num text-right">{moneyText(l.base)}</td>
                        <td className="num text-right">
                          {adj !== BigInt(0) ? signed(adj) : ""}
                          {l.adjustments.map((a) => (
                            <span key={a.adj.id} className="small muted block">
                              {REASON_LABEL[a.adj.reason]}
                            </span>
                          ))}
                        </td>
                        <td className="num text-right">{moneyText(l.pay)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="small muted mt-1 mb-0">Live lb to 3 decimals and each lamb&apos;s pay to the cent are for reading only.</p>
          </details>
        </>
      )}
    </section>
  );
}

const signed = (v: bigint) => (v < BigInt(0) ? `− ${moneyText(-v)}` : `+ ${moneyText(v)}`);
const perLb = (amount: string | number) => {
  const n = Number(amount);
  return `${n < 0 ? "−" : ""}${rateText(String(amount).replace("-", ""))}/live lb`;
};

// ----- Adjustments -----

function Adjustments({ sheet, pay, refresh }: { sheet: KillSheet; pay: SheetPay; refresh: () => void }) {
  const db = getDb();
  const toast = useToast();
  const [target, setTarget] = useState("sheet");
  const [direction, setDirection] = useState<"add" | "off">("add");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<AdjustmentKind>("dollars");
  const [reason, setReason] = useState<AdjustmentReason>("premium");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const all = [
    ...pay.lambs.flatMap((l) => l.adjustments.map((a) => ({ ...a, where: `Lamb ${l.lamb.position}` }))),
    ...pay.sheetAdjustments.map((a) => ({ ...a, where: "Whole sheet" })),
  ];

  const add = async () => {
    const v = parseRate(amount);
    if (v == null || Number(v) === 0) return toast("Type an amount like 10 or 0.05");
    if (reason === "other" && !note.trim()) return toast("Type a note for \"Other\"");
    setBusy(true);
    const err = await addAdjustment(db, {
      sheetId: sheet.id,
      lambId: target === "sheet" ? null : target,
      kind,
      amount: direction === "off" ? `-${v}` : v,
      reason,
      note,
    });
    setBusy(false);
    if (err) return toast(`Couldn't save: ${err}`);
    toast("Adjustment saved");
    setAmount("");
    setNote("");
    refresh();
  };
  const remove = async (a: KillAdjustment, where: string) => {
    if (!confirm(`Remove the ${REASON_LABEL[a.reason].toLowerCase()} on ${where.toLowerCase()}?`)) return;
    const err = await deleteAdjustment(db, a.id);
    toast(err ? `Couldn't remove it: ${err}` : "Removed");
    refresh();
  };

  return (
    <section className="panel mt-3" aria-labelledby="ws-adj">
      <h3 id="ws-adj">Adjustments</h3>
      <p className="small muted mt-1">A premium, dock, hauling or other change, on one lamb or the whole sheet. Every one is logged.</p>
      {all.length > 0 && (
        <ul className="m-0 mb-2 list-none p-0">
          {all.map(({ adj, money, where }) => (
            <li key={adj.id} className="flex flex-wrap items-center gap-x-3 border-t border-line py-1.5">
              <span className="min-w-0 flex-1">
                <b>{where}</b> · {REASON_LABEL[adj.reason]}
                {adj.kind === "per_live_lb" ? ` · ${perLb(adj.amount)}` : ""}
                {adj.note && <span className="small muted block">{adj.note}</span>}
              </span>
              <span className="num">{signed(money)}</span>
              <button type="button" className="copy min-h-[44px] px-2" onClick={() => void remove(adj, where)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="grid gap-1">
          <span className="lbl m-0">On</span>
          <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="sheet">Whole sheet</option>
            {pay.lambs.map((l) => (
              <option key={l.lamb.id} value={l.lamb.id}>
                Lamb {l.lamb.position} ({Number(l.lamb.carcass_lb)} lb)
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Reason</span>
          <select
            className="field"
            value={reason}
            onChange={(e) => {
              const r = e.target.value as AdjustmentReason;
              setReason(r);
              setDirection(r === "dock" ? "off" : "add");
            }}
          >
            {ADJUSTMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Add or take off</span>
          <select className="field" value={direction} onChange={(e) => setDirection(e.target.value as "add" | "off")}>
            <option value="add">Add to pay</option>
            <option value="off">Take off pay</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Amount</span>
          <input className="field num w-24!" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">As</span>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)}>
            <option value="dollars">Dollars</option>
            <option value="per_live_lb">$/live lb</option>
          </select>
        </label>
        <label className="grid min-w-[10rem] flex-1 gap-1">
          <span className="lbl m-0">Note{reason === "other" ? "" : " (optional)"}</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={busy || !amount.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

// ----- Photos of the paper sheet -----

/** Shrink a phone photo to about 2400 px JPEG: small enough to send, sharp enough to read handwriting. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

function Photos({ sheetId, photos, refresh }: { sheetId: string; photos: KillSheetPhoto[]; refresh: () => void }) {
  const db = getDb();
  const toast = useToast();
  const [links, setLinks] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const pathsKey = photos.map((p) => p.path).join(",");

  useEffect(() => {
    let live = true;
    photoLinks(db, pathsKey ? pathsKey.split(",") : [])
      .then((m) => live && setLinks(m))
      .catch(() => live && setLinks(new Map()));
    return () => {
      live = false;
    };
  }, [db, pathsKey]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const err = await addSheetPhoto(db, sheetId, await shrink(f));
      if (err) toast(`Couldn't add the photo: ${err}`);
    }
    setBusy(false);
    refresh();
  };
  const remove = async (p: KillSheetPhoto) => {
    if (!confirm("Delete this photo?")) return;
    const err = await deleteSheetPhoto(db, p);
    toast(err ? `Couldn't delete it: ${err}` : "Photo deleted");
    refresh();
  };

  return (
    <section className="panel mt-3" aria-labelledby="ws-photos">
      <h3 id="ws-photos">Photo of the paper sheet</h3>
      {photos.length === 0 && <p className="small muted mt-1">No photo yet.</p>}
      <div className="mt-1 flex flex-wrap gap-3">
        {photos.map((p) => {
          const url = links.get(p.path);
          return (
            <figure key={p.id} className="m-0 grid gap-1">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed link */}
                  <img src={url} alt="Mohawk's paper kill sheet" className="h-40 w-auto rounded border border-line" />
                </a>
              ) : (
                <span className="small muted">Loading photo...</span>
              )}
              <button type="button" className="copy min-h-[44px] text-left" onClick={() => void remove(p)}>
                Delete photo
              </button>
            </figure>
          );
        })}
      </div>
      <label className="btn ghost mt-2 inline-flex cursor-pointer">
        {busy ? "Adding..." : "Add a photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
    </section>
  );
}

// ----- Producer, kill date, notes, rates, delete -----

function Details({
  sheet,
  setup,
  photoPaths,
  lambs,
  refresh,
}: {
  sheet: KillSheet;
  setup: LambCostSetup;
  photoPaths: string[];
  lambs: number;
  refresh: () => void;
}) {
  const db = getDb();
  const toast = useToast();
  const router = useRouter();
  const choices = setup.producers.filter((p) => p.active || p.id === sheet.producer_id);
  const setupNow = rateFor(setup.settings, setup.rates, sheet.producer_id, sheet.kill_date);
  const isOverride = sheet.rate_source === "override";
  const differs =
    !isOverride &&
    setupNow != null &&
    (Number(setupNow.rate) !== Number(sheet.base_rate) || Number(setupNow.factor) !== Number(sheet.live_factor));
  const loadClosed = useCallback((d: SupabaseClient) => weekIsClosed(d, sheet.week_id), [sheet.week_id]);
  const { data: closed } = useLive(`week-closed:${sheet.week_id}`, loadClosed, ["pnl_closed_weeks"]);
  const [rate, setRate] = useState("");
  const [factor, setFactor] = useState("");
  const [reason, setReason] = useState("");

  const change = async (c: Partial<{ producer_id: string; kill_date: string; notes: string }>, ok: string) => {
    const err = await updateSheet(db, sheet.id, c);
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
  };
  const takeSetupRates = async () => {
    if (!setupNow) return;
    if (!confirm(`Use the setting: ${rateText(setupNow.rate)} per lb live and factor ${factorText(setupNow.factor)} on this kill?`)) return;
    const err = await applySetupRates(db, sheet.id);
    toast(err ? `Couldn't change it: ${err}` : "This kill now uses the setting");
    refresh();
  };
  const saveOverride = async () => {
    const r = parseRate(rate);
    const f = parseFactor(factor);
    if (r == null) return toast("Type the rate like 3.00");
    if (f == null) return toast("Type the factor like 2.02");
    if (!reason.trim()) return toast("Type why this kill is different");
    const err = await setSheetOverride(db, sheet.id, r, f, reason.trim());
    toast(err ? `Couldn't save: ${err}` : "Override saved");
    if (!err) {
      setRate("");
      setFactor("");
      setReason("");
    }
    refresh();
  };
  const remove = async () => {
    if (!confirm(`Delete this sheet${lambs ? ` and its ${lambs} weights` : ""}? It stays in the change log.`)) return;
    const err = await deleteSheet(db, sheet.id, photoPaths);
    if (err) return toast(`Couldn't delete it: ${err}`);
    toast("Sheet deleted");
    router.push("/carcass-weights");
  };

  return (
    <section className="panel mt-3" aria-labelledby="ws-details">
      <h3 id="ws-details">Sheet details</h3>
      <p className="mt-1">
        Paid at <b className="num">{rateText(sheet.base_rate)}</b> per lb live, live weight factor{" "}
        <b className="num">{factorText(sheet.live_factor)}</b>
        {isOverride ? <span className="tag short ml-1">Override</span> : <span className="muted"> · {rateOriginText(sheet, setup)}</span>}
      </p>
      {isOverride && (
        <p className="note small">
          This kill has its own rate and factor: {sheet.override_reason}.
          {!closed && setupNow && (
            <button type="button" className="btn ghost ml-1" onClick={() => void takeSetupRates()}>
              Go back to the setting
            </button>
          )}
        </p>
      )}
      {closed && <p className="note small">This week is closed, so this kill keeps its rate and factor.</p>}
      {!closed && differs && setupNow && (
        <p className="note small">
          The setting says {rateText(setupNow.rate)} and factor {factorText(setupNow.factor)} for {longDate(sheet.kill_date)}.{" "}
          <button type="button" className="btn ghost ml-1" onClick={() => void takeSetupRates()}>
            Use the setting
          </button>
        </p>
      )}
      {!closed && !isOverride && (
        <details className="mt-2">
          <summary className="copy">Give this kill its own rate (special case)</summary>
          <p className="small muted mt-1">Changes to the settings won&apos;t reach this kill while it has its own rate.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="lbl m-0">Rate ($ per lb live)</span>
              <input className="field num w-28!" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="lbl m-0">Live weight factor</span>
              <input className="field num w-28!" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} />
            </label>
            <label className="grid min-w-[12rem] flex-1 gap-1">
              <span className="lbl m-0">Why</span>
              <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button type="button" className="btn ghost" disabled={!rate.trim() || !factor.trim() || !reason.trim()} onClick={() => void saveOverride()}>
              Save override
            </button>
          </div>
        </details>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="lbl m-0">Producer</span>
          <select
            className="field"
            value={sheet.producer_id}
            onChange={(e) => {
              const v = e.target.value;
              if (confirm("Change the producer? The sheet takes their rate from Setup for this kill date.")) {
                void change({ producer_id: v }, "Producer changed");
              } else e.target.value = sheet.producer_id;
            }}
          >
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Kill date</span>
          <input
            type="date"
            className="field"
            defaultValue={sheet.kill_date}
            key={sheet.kill_date}
            onBlur={(e) => {
              const v = e.target.value;
              if (!v || v === sheet.kill_date) return;
              if (confirm("Change the kill date? The sheet takes the rate from Setup for the new date, and may move to another week.")) {
                void change({ kill_date: v }, "Kill date changed");
              } else e.target.value = sheet.kill_date;
            }}
          />
        </label>
      </div>
      <label className="mt-2 grid gap-1">
        <span className="lbl m-0">Notes</span>
        <textarea
          className="field"
          rows={2}
          defaultValue={sheet.notes}
          key={sheet.notes}
          onBlur={(e) => {
            if (e.target.value.trim() !== sheet.notes) void change({ notes: e.target.value.trim() }, "Notes saved");
          }}
        />
      </label>
      <button type="button" className="btn ghost mt-3" onClick={() => void remove()}>
        Delete this sheet
      </button>
    </section>
  );
}
