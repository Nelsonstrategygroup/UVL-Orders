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
import { longDate } from "@/lib/dates";
import {
  manifestFile,
  ManifestSheets,
  manifestsTable,
  palletManifests,
  paperworkWarnings,
  pickPallets,
} from "../Manifest";
import { PrintWarnings, usePrintGuard } from "@/components/PrintGuard";

export default function ManifestScreen() {
  const params = useSearchParams();
  const { week, setWeek } = useWeek();
  const toast = useToast();
  const { waiting } = useOutbox();
  const asked = params.get("week");
  // Opened for a week (from Print and download, or a pallet): show that week.
  useEffect(() => {
    if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked !== week)
      setWeek(asked);
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const onWeek = !asked || asked === week;
  const bundle = usePackingBundle(week);
  const palletId = params.get("pallet");
  // ?date=2026-11-04 (or "none": no ship date yet): every pallet shipping that day, by distributor.
  const date = params.get("date");
  const picked = bundle.data && onWeek ? pickPallets(bundle.data, { palletId, date }) : null;
  const ids = picked ? [...picked.groups.flatMap((g) => g.pallets.map((r) => r.pallet.id)), ...picked.blocked.map((b) => b.pallet.id)] : [];
  const list = bundle.data && picked ? palletManifests(bundle.data).filter((m) => ids.includes(m.pallet.id)) : null;

  // Warnings show here only, never on the printed pages; printing asks first while there are any.
  const warnings = bundle.data && picked ? paperworkWarnings(bundle.data, { palletId, date }, { asOf: { at: bundle.savedAt, fromPhone: bundle.fromPhone } }) : [];
  const guard = usePrintGuard(warnings);
  // ?print=1: printing starts once, when the manifest is drawn.
  const printed = useRef(false);
  useEffect(() => {
    if (params.get("print") !== "1" || printed.current || !list?.length) return;
    printed.current = true;
    const t = setTimeout(() => guard.print(), 400);
    return () => clearTimeout(t);
    // guard changes every render; this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, list]);

  if (bundle.error)
    return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!bundle.data || !list)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const title = palletId
    ? `Manifest for pallet ${list[0]?.pallet.tag ?? ""}`
    : date
      ? `Manifests for ${date === "none" ? "pallets with no ship date yet" : longDate(date)}`
      : "Manifests for every pallet";
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
          <button
            type="button"
            className="btn"
            disabled={!list.length}
            onClick={() => guard.print()}
          >
            Print
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!list.length}
            onClick={() => guard.print(() => toast('In the print window, choose "Save as PDF" as the printer.'))}
          >
            Save as PDF
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!list.length}
            onClick={() =>
              void downloadTable(
                manifestFile(bundle.data!.packing.invNumber, week, palletId ? list[0].pallet.tag : undefined),
                manifestsTable(list, bundle.data!.packing.invNumber, week),
                "Manifest",
                "csv",
              )
            }
          >
            Download CSV
          </button>
        </div>
        {!list.length && (
          <div className="empty">
            {palletId
              ? "This pallet isn't in this week."
              : "No pallets this week yet."}
          </div>
        )}
        {waiting > 0 && (
          <p className="note warn mt-2">
            {waiting} {waiting === 1 ? "thing is" : "things are"} still waiting
            on this phone, so the manifest may be missing boxes until they
            upload.
          </p>
        )}
      </div>
      {/* A cover page per pallet, then each customer on its own Letter page. Cross dock sheets print from their own option. */}
      <PrintWarnings warnings={warnings} />
      {guard.dialog}
      <style>{`@media print { @page { size: letter portrait; margin: 0.4in; } }`}</style>
      <ManifestSheets data={bundle.data} pick={{ palletId, date }} showLoose={!palletId && !date} />
    </>
  );
}
