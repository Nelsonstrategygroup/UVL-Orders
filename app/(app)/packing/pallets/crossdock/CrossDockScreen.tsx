"use client";

// Cross dock sheets (Lucas, 11/2/26): one Letter page per distributor per
// ship date, from the week's pallets and their scanned boxes. On screen,
// each distributor's pallets can be given their ship date here; pallets with
// no distributor (or mixed) are listed with what to fix in Setup.

import Link from "next/link";
import { useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import { useToast } from "@/components/Toast";
import { WeekBar } from "@/components/Week";
import { longDate } from "@/lib/dates";
import { setPalletShipDate } from "@/lib/db/scanning";
import { paperworkContext, pickPallets, weekDuplicates } from "../Manifest";
import { CrossDockSheet } from "../Paperwork";
import { dateWords, usePaperworkWeek, usePrintOnce } from "../usePaperworkWeek";

export default function CrossDockScreen() {
  const { onWeek, bundle, date, print } = usePaperworkWeek();
  const canPacking = useCan("packing").change;
  const canWeek = useCan("week").change;
  const canChange = canPacking || canWeek;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const picked = bundle.data && onWeek ? pickPallets(bundle.data, { date }) : null;
  usePrintOnce(print, !!picked?.groups.length);

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!bundle.data || !picked)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const ctx = paperworkContext(bundle.data);
  const dups = weekDuplicates(bundle.data);
  async function setDate(ids: string[], d: string) {
    setBusy(true);
    const err = await setPalletShipDate(getDb(), ids, d || null);
    setBusy(false);
    if (err) return toast(`Couldn't save: ${err}`);
    toast("Ship date saved");
    bundle.refresh();
  }

  return (
    <>
      <div className="screen-only">
        <WeekBar inv={bundle.data.packing.invNumber} />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto">Cross dock sheets{date ? ` for ${dateWords(date === "none" ? null : date, longDate)}` : ""}</h2>
          <Link href="/packing/pallets" className="btn ghost">
            &larr; Pallets
          </Link>
          <button type="button" className="btn" disabled={!picked.groups.length} onClick={() => window.print()}>
            Print
          </button>
        </div>
        <p className="small muted mt-1">
          One page per distributor and ship date. Cases and weight are the boxes scanned onto each pallet.
        </p>
        {!picked.groups.length && <div className="empty">No pallets with a distributor {date ? "for this date" : "this week"} yet.</div>}
        {picked.blocked.map(({ pallet, problem }) => (
          <p key={pallet.id} className="note warn">
            <b>{pallet.tag || "A pallet"}</b> isn&apos;t on a cross dock sheet: {problem}{" "}
            <Link href="/setup/pallets" className="copy">
              Setup &gt; Ships to
            </Link>
          </p>
        ))}
        {canChange &&
          picked.groups.map((g) => (
            <div key={`${g.point.id}|${g.shipDate ?? ""}`} className="mt-2 flex flex-wrap items-center gap-2">
              <span>
                <b>{g.point.name}</b> ({g.pallets.map((r) => r.pallet.tag).join(", ")}) ships
              </span>
              <input
                type="date"
                className="field w-auto!"
                aria-label={`Ship date for ${g.point.name}`}
                defaultValue={g.shipDate ?? ""}
                disabled={busy}
                onChange={(e) => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) || e.target.value === "") void setDate(g.pallets.map((r) => r.pallet.id), e.target.value);
                }}
              />
            </div>
          ))}
      </div>
      <style>{`@media print { @page { size: letter portrait; margin: 0.4in; } }`}</style>
      <div className="pkmanifest">
        {picked.groups.map((g) => (
          <CrossDockSheet
            key={`${g.point.id}|${g.shipDate ?? ""}`}
            group={g}
            ctx={ctx}
            dups={dups.filter((d) => d.where.some((w) => g.pallets.some((r) => w.endsWith(` · ${r.pallet.tag}`))))}
          />
        ))}
      </div>
    </>
  );
}
