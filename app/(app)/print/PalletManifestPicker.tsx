"use client";

// Print and download > Cross dock sheets, Pallet labels, Pallet manifests
// (Lucas, 11/2/26): pick a ship date from the week's pallets and print all
// for it. Manifests for a date come grouped by distributor, each
// distributor's cross dock sheet first, then each pallet's customer pages.
// The manifest CSV (one row per box) is kept. Opens the same pages as
// Pallets.

import Link from "next/link";
import { useState } from "react";
import { downloadTable } from "@/components/download";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { longDate, weekName } from "@/lib/dates";
import { manifestFile, manifestsTable, palletManifests } from "../packing/pallets/Manifest";

export type PalletPaper = "crossdock" | "labels" | "manifests";

const PATH: Record<PalletPaper, string> = {
  crossdock: "/packing/pallets/crossdock",
  labels: "/packing/pallets/pallet-labels",
  manifests: "/packing/pallets/manifest",
};

export default function PalletManifestPicker({ week, kind }: { week: string; kind: PalletPaper }) {
  const bundle = usePackingBundle(week);
  const [picked, setPicked] = useState<string | null>(null);
  if (bundle.error) return <span className="small muted">Couldn&apos;t load the pallets.</span>;
  if (!bundle.data) return <span className="small muted">Loading pallets...</span>;

  const pallets = bundle.data.pallets;
  if (!pallets.length) return <span className="small muted">No pallets for {weekName(week)} yet.</span>;
  // The week's ship dates, soonest first; "none" for pallets without one yet.
  const dates = [...new Set(pallets.map((p) => p.ship_date ?? "none"))].sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : a.localeCompare(b)));
  const date = picked && dates.includes(picked) ? picked : dates[0];
  const href = `${PATH[kind]}?week=${week}&date=${date}`;

  return (
    <div className="grid w-full gap-2">
      <select className="field" aria-label="Ship date" value={date} onChange={(e) => setPicked(e.target.value)}>
        {dates.map((d) => (
          <option key={d} value={d}>
            {d === "none" ? "No ship date yet" : `Ships ${longDate(d)}`} · {pallets.filter((p) => (p.ship_date ?? "none") === d).length} pallet
            {pallets.filter((p) => (p.ship_date ?? "none") === d).length === 1 ? "" : "s"}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <Link href={`${href}&print=1`} className="btn">
          Print all for this date
        </Link>
        <Link href={href} className="btn ghost">
          Open
        </Link>
        {kind === "manifests" && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const inv = bundle.data?.packing.invNumber ?? null;
              const list = palletManifests(bundle.data!);
              void downloadTable(manifestFile(inv, week), manifestsTable(list, inv, week), "Manifest", "csv");
            }}
          >
            Download CSV
          </button>
        )}
      </div>
    </div>
  );
}
