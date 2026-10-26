"use client";

// The pallet manifest page (change request 10/26/26). Opened from Pallets
// ("Print manifest" on a pallet, or all of them) and from Print and download
// ("Pallet manifest"). ?pallet=<id> for one pallet, none for the whole
// week; ?week= keeps the week it was opened for; ?print=1 opens the print
// dialog once it's drawn. Works from the copy Packing keeps on the phone.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { downloadTable } from "@/components/download";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { ManifestSheets, manifestsTable, palletManifests } from "../Manifest";

export default function ManifestScreen() {
  const params = useSearchParams();
  const { week, setWeek } = useWeek();
  const toast = useToast();
  const { waiting } = useOutbox();
  const asked = params.get("week");
  // Opened for a week (from Print and download, or a pallet): show that week.
  useEffect(() => {
    if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked !== week) setWeek(asked);
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const onWeek = !asked || asked === week;
  const bundle = usePackingBundle(week);
  const palletId = params.get("pallet");
  const list = bundle.data && onWeek ? palletManifests(bundle.data, palletId ? [palletId] : undefined) : null;

  // ?print=1: the print dialog opens once, when the manifest is drawn.
  const printed = useRef(false);
  useEffect(() => {
    if (params.get("print") !== "1" || printed.current || !list?.length) return;
    printed.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [params, list]);

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!bundle.data || !list)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const missing = list.reduce((n, m) => n + m.manifest.missing, 0);
  const title = palletId ? `Manifest for pallet ${list[0]?.pallet.tag ?? ""}` : "Manifests for every pallet";
  return (
    <>
      <div className="screen-only">
        <WeekBar inv={bundle.data.packing.invNumber} />
        <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto">{title}</h2>
          <Link href="/packing/pallets" className="btn ghost">
            &larr; Pallets
          </Link>
          <button type="button" className="btn" disabled={!list.length} onClick={() => window.print()}>
            Print
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!list.length}
            onClick={() => {
              toast('In the print window, choose "Save as PDF" as the printer.');
              setTimeout(() => window.print(), 600);
            }}
          >
            Save as PDF
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!list.length}
            onClick={() => void downloadTable(`manifest-${palletId ? list[0].pallet.tag : "all"}-week-of-${week}`, manifestsTable(list), "Manifest", "csv")}
          >
            Download CSV
          </button>
        </div>
        {!list.length && <div className="empty">{palletId ? "This pallet isn't in this week." : "No pallets this week yet."}</div>}
        {missing > 0 && (
          <p className="note bad mt-2" role="alert">
            <b>
              {missing} box{missing === 1 ? " has" : "es have"} no weight.
            </b>{" "}
            They show as MISSING. Weigh them before printing.
          </p>
        )}
        {waiting > 0 && (
          <p className="note warn mt-2">
            {waiting} {waiting === 1 ? "thing is" : "things are"} still waiting on this phone, so the manifest may be missing boxes
            until they upload.
          </p>
        )}
      </div>
      <ManifestSheets data={bundle.data} list={list} />
    </>
  );
}
