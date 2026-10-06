"use client";

// Cut sheet (SPEC 5.5), ported from the prototype's renderCutsheet.

import { useCallback, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import MohawkSheet from "@/components/MohawkSheet";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { emailSubject, hashText, USE_GROUPS, USES, type CutSpecLite } from "@/lib/calc/cutsheet";
import { setTitle, sheetProblems, sheetStatus, sheetText } from "@/lib/cutsheetView";
import { orderingCustomers, sortByDisplayName } from "@/lib/calc/customers";
import { num } from "@/lib/calc/num";
import { cutSheetTotals } from "@/lib/calc/summary";
import { niceDate } from "@/lib/dates";
import { formatDateTime } from "@/lib/format";
import * as cs from "@/lib/db/cutsheet";
import type { SheetLine, SheetSet } from "@/lib/db/cutsheet";
import SetCard, { type SetActions } from "./SetCard";

const LIVE_TABLES = ["cut_sheets", "cut_sets", "cut_set_lines", "orders", "order_lines"];

export default function CutSheetScreen() {
  const { week } = useWeek();
  const { catalog, customers, error: loadError, reloadCatalog } = useStaffData();
  const toast = useToast();
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => cs.loadCutSheet(d, week), [week]);
  const { data, error, refresh } = useLive(`cutsheet-${week}`, load, LIVE_TABLES);
  const [newSpecFor, setNewSpecFor] = useState<SheetLine | null>(null);
  const [confirmSend, setConfirmSend] = useState<null | "print" | "email">(null);
  // After printing or emailing: "Did this go to Mohawk?" Remembers what was sent.
  const [askSent, setAskSent] = useState<null | { how: "print" | "email"; hash: string }>(null);

  const specMap = useMemo(
    () => new Map<string, CutSpecLite>((catalog?.cutSpecs ?? []).map((s) => [s.id, s])),
    [catalog],
  );

  if (loadError || error) return <p className="note bad">Couldn&apos;t load the cut sheet: {loadError || error}</p>;
  if (!catalog || !customers || !data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading the cut sheet...</div>
      </>
    );

  const processor = catalog.settings?.processor_name || "Mohawk";
  const defaultSize = catalog.sizes.find((z) => z.id === "Large")?.id ?? catalog.sizes[0]?.id ?? null;

  /** Run a save, show a plain message if it fails, then reload. */
  async function run(p: Promise<string | null>): Promise<boolean> {
    const err = await p;
    if (err) toast("Couldn't save. Check the internet connection.");
    refresh();
    return !err;
  }

  // ----- Empty week -----
  if (!data.sheet) {
    const from = data.lastWeekWithSheet;
    return (
      <>
        <WeekBar processDate={data.processDate} />
        <div className="panel empty mx-auto max-w-[560px]">
          <h3 className="mb-2">No cut sheet for this week yet</h3>
          <p>Most weeks look a lot like the last one, so the quickest start is a copy.</p>
          {from && (
            <button
              type="button"
              className="bigbtn mx-auto max-w-[420px]"
              onClick={async () => {
                if (await run(cs.copySheet(db, from, week)))
                  toast("Copied. Change the numbers for this week.", () => void run(cs.removeUnsentSheet(db, week)));
              }}
            >
              Copy the week of {niceDate(from)}
            </button>
          )}
          <button
            type="button"
            className="btn ghost mt-3"
            onClick={async () => {
              if (await run(cs.startBlankSheet(db, week, defaultSize)))
                toast("Blank sheet started", () => void run(cs.removeUnsentSheet(db, week)));
            }}
          >
            Start a blank sheet
          </button>
        </div>
      </>
    );
  }

  // ----- Sheet -----
  const sh = data.sheet;
  const perLamb = Object.fromEntries(catalog.parts.map((p) => [p.id, p.per_lamb]));
  const totals = cutSheetTotals(data.sets, catalog.sizes);
  const problems = sheetProblems(data, catalog, specMap);
  const titleOf = (s: SheetSet) => setTitle(s, catalog);
  const standing = catalog.settings?.standing_instructions ?? "";

  const textFor = (updated: boolean) => sheetText(data, catalog, specMap, updated);
  const plain = textFor(false);
  const status = sheetStatus(data, catalog, specMap);
  const changed = status.kind === "changed";
  const when = sh.sent_at ? formatDateTime(sh.sent_at) : "";

  async function markSentNow(hash = hashText(plain)) {
    await run(cs.markSent(db, week, hash));
  }

  // Printing or emailing doesn't mark it sent by itself: Kathy may print a
  // copy to check, or close the email without sending. Ask afterward.
  function doPrint() {
    setAskSent({ how: "print", hash: hashText(plain) });
    // The question is hidden when printing; it's there when the print window closes.
    setTimeout(() => window.print(), 50);
  }

  function doEmail() {
    const subject = emailSubject(sh.inv_number, changed, niceDate(week));
    setAskSent({ how: "email", hash: hashText(plain) });
    window.location.assign(
      `mailto:${encodeURIComponent(catalog!.settings?.processor_email ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textFor(changed))}`,
    );
    toast("Opening your email. Check it and press Send.");
  }

  const send = (how: "print" | "email") => {
    if (problems.length) setConfirmSend(how);
    else if (how === "print") doPrint();
    else doEmail();
  };

  // ----- Set and line actions -----
  const actionsFor = (s: SheetSet, i: number): SetActions => ({
    updateSet: (patch) => void run(cs.updateSet(db, s.id, patch)),
    move: (dir) => {
      const other = data.sets[i + dir];
      if (other) void run(cs.swapSort(db, "cut_sets", s, other));
    },
    remove: async () => {
      try {
        const snap = await cs.snapshotSet(db, s.id);
        if (await run(cs.deleteSet(db, s.id))) toast("Set deleted", () => void run(cs.restoreSet(db, snap)));
      } catch {
        toast("Couldn't delete. Check the internet connection.");
      }
    },
    addLine: () => {
      const first = catalog.cutSpecs.find((x) => x.active);
      if (!first) return toast("Add an instruction in Setup first.");
      const sort = Math.max(-1, ...s.lines.map((l) => l.sort)) + 1;
      void run(cs.addLine(db, s.id, sort, first.id));
    },
    updateLine: (l, patch) => void run(cs.updateLine(db, l.id, patch)),
    moveLineUp: (j) => {
      const a = s.lines[j];
      const b = s.lines[j - 1];
      if (a && b) void run(cs.swapSort(db, "cut_set_lines", a, b));
    },
    removeLine: async (l) => {
      try {
        const snap = await cs.snapshotSet(db, s.id);
        if (await run(cs.deleteLine(db, l.id))) toast("Line deleted", () => void run(cs.restoreSet(db, snap)));
      } catch {
        toast("Couldn't delete. Check the internet connection.");
      }
    },
    newInstruction: (l) => setNewSpecFor(l),
    link: (cid) => void run(cs.linkCustomer(db, s.id, cid)),
    unlink: (cid) => void run(cs.unlinkCustomer(db, s.id, cid)),
    fill: async () => {
      const r = await cs.fillSetFromOrders(db, s.id);
      refresh();
      if (r.error) return toast("Couldn't add them. Check the internet connection.");
      toast(`${r.added} order line${r.added === 1 ? "" : "s"} added to the set`, () => void run(cs.restoreSet(db, r.before)));
    },
  });

  const ordering = sortByDisplayName(orderingCustomers(customers.list), customers.byId).map((c) => c.id);

  return (
    <>
      <div className="screen-only">
        <WeekBar processDate={data.processDate} />

        <div className="mb-2 flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2>Cut sheet</h2>
            <span className="muted">
              {totals.total} lamb{totals.total === 1 ? "" : "s"}
              {totals.bySize.length > 0 && `: ${totals.bySize.map((x) => `${x.lambs} ${x.label}`).join(", ")}`}
            </span>
          </div>
          <div className="w-36">
            <label className="lbl mt-0!" htmlFor="inv">
              INV#
            </label>
            <input
              id="inv"
              key={`inv-${sh.inv_number}`}
              className="field"
              defaultValue={sh.inv_number}
              onBlur={(e) => e.target.value.trim() !== sh.inv_number && void run(cs.updateSheet(db, week, { inv_number: e.target.value.trim() }))}
            />
          </div>
        </div>

        {problems.length ? (
          <div className="cutstat changed">
            {problems.map(titleOf).join(", ")} {problems.length > 1 ? "don't" : "doesn't"} add up to whole lambs. The red counts
            below show where.
          </div>
        ) : (
          <div className="cutstat sent">Every set adds up to whole lambs.</div>
        )}
        <SentLine kind={status.kind} processor={processor} when={when} by={sh.sent_by_name} />

        <section className="panel mt-4">
          <h3>Instructions at the top</h3>
          <p className="small muted mt-1 mb-2">
            Ongoing saving goals carry to every week until you mark them finished. Banners are for this week only.
          </p>
          {data.goals.map((g) => (
            <div key={g.id} className="banrow">
              <input
                key={`g-${g.text}`}
                className="field"
                aria-label="Saving goal"
                placeholder="What to save, and how much"
                defaultValue={g.text}
                onBlur={(e) => e.target.value.trim() !== g.text && void run(cs.updateGoal(db, g.id, { text: e.target.value.trim() }))}
              />
              <button
                type="button"
                className="btn ghost shrink-0"
                onClick={async () => {
                  if (await run(cs.updateGoal(db, g.id, { active: false })))
                    toast("Goal finished. It won't print next week.", () => void run(cs.updateGoal(db, g.id, { active: true })));
                }}
              >
                Finished
              </button>
            </div>
          ))}
          <button type="button" className="linkbtn" onClick={() => void run(cs.addGoal(db))}>
            Add a saving goal (bones, bellies, necks)
          </button>

          <div className="mt-2">
            {data.banners.map((b) => (
              <div key={b.id} className="banrow">
                <input
                  key={`b-${b.text}`}
                  className="field"
                  aria-label="Banner for this week"
                  placeholder="Banner for this week"
                  defaultValue={b.text}
                  onBlur={(e) => e.target.value.trim() !== b.text && void run(cs.updateBanner(db, b.id, e.target.value.trim()))}
                />
                <button type="button" className="iconbtn shrink-0" aria-label="Remove banner" onClick={() => void run(cs.removeBanner(db, b.id))}>
                  &#10005;
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="linkbtn"
            onClick={() => void run(cs.addBanner(db, week, Math.max(-1, ...data.banners.map((b) => b.sort)) + 1))}
          >
            Add a banner for this week
          </button>
        </section>

        {data.sets.map((s, i) => (
          <SetCard
            key={s.id}
            set={s}
            index={i}
            count={data.sets.length}
            week={week}
            cutSpecs={catalog.cutSpecs}
            specMap={specMap}
            perLamb={perLamb}
            sizes={catalog.sizes}
            products={catalog.products}
            customers={customers}
            orders={data.orders}
            orderingIds={ordering}
            title={titleOf(s)}
            act={actionsFor(s, i)}
          />
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => void run(cs.addSet(db, week, Math.max(-1, ...data.sets.map((s) => s.sort)) + 1, defaultSize))}
        >
          Add a set
        </button>

        <section className="panel mt-4">
          <h3>Bottom of the sheet</h3>
          <div className="flex flex-wrap gap-3">
            {(["large", "medium", "small"] as const).map((k) => {
              const field = `pulled_${k}` as const;
              const v = sh[field];
              return (
                <div key={k} className="w-40">
                  <label className="lbl" htmlFor={`pl-${k}`}>
                    Pulled from inventory, {k}
                  </label>
                  <input
                    id={`pl-${k}`}
                    key={`${k}-${v}`}
                    className="field num"
                    inputMode="numeric"
                    defaultValue={v ?? ""}
                    onBlur={(e) => {
                      const t = e.target.value.trim();
                      const n = t === "" ? null : Math.max(0, Math.round(num(t)));
                      if (n !== v) void run(cs.updateSheet(db, week, { [field]: n }));
                    }}
                  />
                </div>
              );
            })}
          </div>
          <label className="lbl" htmlFor="csnotes">
            UVL notes
          </label>
          <textarea
            id="csnotes"
            key={`notes-${sh.notes}`}
            className="field"
            rows={2}
            defaultValue={sh.notes}
            onBlur={(e) => e.target.value.trim() !== sh.notes && void run(cs.updateSheet(db, week, { notes: e.target.value.trim() }))}
          />
        </section>

        <section className="panel mt-4">
          <h3>What {processor} gets</h3>
          <div className="my-2">
            <MohawkSheet data={data} specs={specMap} sizes={catalog.sizes} standing={standing} />
          </div>
          <button type="button" className="bigbtn" onClick={() => send("print")}>
            Print or save as PDF
          </button>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn ghost" onClick={() => send("email")}>
              {changed ? "Email the update to " : "Email to "}
              {processor}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                (navigator.clipboard ? navigator.clipboard.writeText(textFor(changed)) : Promise.reject()).then(
                  () => toast("Copied. Paste it into an email or text."),
                  () => toast("Couldn't copy on this device"),
                )
              }
            >
              Copy as text
            </button>
            {status.kind !== "sent" && (
              <button
                type="button"
                className="linkbtn ml-auto"
                onClick={async () => {
                  await markSentNow();
                  toast("Marked as sent");
                }}
              >
                I sent it another way
              </button>
            )}
          </div>
          <p className="small muted mt-2 mb-0">
            After you print or email it, the app asks if it went to {processor}. Email sends a plain-text version; for the colored one, print it or save a
            PDF and attach that.
            {!catalog.settings?.processor_email && ` Add ${processor}'s email address in Setup and it fills in automatically.`}
          </p>
        </section>
      </div>

      <div className="print-only">
        <MohawkSheet data={data} specs={specMap} sizes={catalog.sizes} standing={standing} />
      </div>

      {newSpecFor && (
        <NewInstruction
          onClose={() => setNewSpecFor(null)}
          onSave={async (text, use) => {
            const r = await cs.addCutSpec(db, text, use);
            if (r.error || !r.id) return toast(`Couldn't add it: ${r.error ?? "unknown error"}`);
            await reloadCatalog();
            await run(cs.updateLine(db, newSpecFor.id, { kind: "line", cut_spec_id: r.id, text: null }));
            setNewSpecFor(null);
            toast("Instruction added. It's saved for next time.");
          }}
        />
      )}

      {askSent && (
        <Sheet title={`Did this go to ${processor}?`} onClose={() => setAskSent(null)}>
          <p className="mt-0 text-[1.05rem]">
            {askSent.how === "print"
              ? `If you'll hand this copy to ${processor}, tap Yes.`
              : "If you pressed Send on the email, tap Yes."}{" "}
            Tap Not yet if you only looked at it.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn ghost" onClick={() => setAskSent(null)}>
              Not yet
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const { hash } = askSent;
                setAskSent(null);
                await markSentNow(hash);
                toast("Marked as sent");
              }}
            >
              Yes
            </button>
          </div>
        </Sheet>
      )}

      {confirmSend && (
        <Sheet title="Some sets don't add up" onClose={() => setConfirmSend(null)}>
          <p className="mt-0 text-[1.05rem]">
            {problems.map(titleOf).join(", ")} {problems.length > 1 ? "don't" : "doesn't"} add up to whole lambs. Send it
            anyway?
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn ghost" onClick={() => setConfirmSend(null)}>
              Go back and fix it
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const how = confirmSend;
                setConfirmSend(null);
                if (how === "print") doPrint();
                else doEmail();
              }}
            >
              Send anyway
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function SentLine({
  kind,
  processor,
  when,
  by,
}: {
  kind: "notsent" | "sent" | "changed";
  processor: string;
  when: string;
  by: string | null;
}) {
  if (kind === "notsent") return <div className="cutstat notsent">Not sent to {processor} yet.</div>;
  if (kind === "changed") return <div className="cutstat changed">Changed after you sent it on {when}. Send an update.</div>;
  return (
    <div className="cutstat sent">
      Sent to {processor} {when}
      {by ? ` by ${by}` : ""}.
    </div>
  );
}

function NewInstruction({ onClose, onSave }: { onClose: () => void; onSave: (text: string, use: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [use, setUse] = useState("leg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="New instruction" onClose={onClose}>
      <p className="small muted mt-0">Write it the way the cutters read it. It&apos;s saved for next time.</p>
      <label className="lbl" htmlFor="ns-text">
        Instruction
      </label>
      <input
        id="ns-text"
        className="field"
        autoFocus
        placeholder='For example: Legs, 1" Steaks 2/pack'
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <label className="lbl" htmlFor="ns-use">
        Each one uses
      </label>
      <select id="ns-use" className="field" value={use} onChange={(e) => setUse(e.target.value)}>
        {USE_GROUPS.map(([group, uses]) => (
          <optgroup key={group} label={group}>
            {uses.map((u) => (
              <option key={u} value={u}>
                {USES[u].label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
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
            if (!text.trim()) return setError("Write the instruction.");
            setBusy(true);
            await onSave(text.trim(), use);
            setBusy(false);
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

