"use client";

// Print and download > Pallet manifest (change request 10/26/26): pick one of
// the week's pallets (tag, destination, boxes) and open its manifest, print
// every pallet's, or download the box rows as a CSV for invoicing. Opens the
// same manifest page as Pallets. Ship dates aren't set yet (Lucas, 10/26/26),
// so the pallets are the week's: the week being looked at, this week to
// start (it holds today's shipment).

import Link from "next/link";
import { useState } from "react";
import { downloadTable } from "@/components/download";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { weekName } from "@/lib/dates";
import { manifestsTable, palletManifests } from "../packing/pallets/Manifest";

export default function PalletManifestPicker({ week }: { week: string }) {
  const bundle = usePackingBundle(week);
  const [picked, setPicked] = useState("");
  if (bundle.error) return <span className="small muted">Couldn&apos;t load the pallets.</span>;
  if (!bundle.data) return <span className="small muted">Loading pallets...</span>;

  const list = palletManifests(bundle.data);
  if (!list.length) return <span className="small muted">No pallets for {weekName(week)} yet.</span>;
  const pallet = list.find((m) => m.pallet.id === picked) ?? list[0];
  const base = `/packing/pallets/manifest?week=${week}`;

  return (
    <div className="grid w-full gap-2">
      <select className="field" aria-label="Pallet" value={pallet.pallet.id} onChange={(e) => setPicked(e.target.value)}>
        {list.map((m) => (
          <option key={m.pallet.id} value={m.pallet.id}>
            {m.pallet.tag} · {m.ship} · {m.manifest.boxes} box{m.manifest.boxes === 1 ? "" : "es"}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <Link href={`${base}&pallet=${pallet.pallet.id}&print=1`} className="btn">
          Open {pallet.pallet.tag}
        </Link>
        <Link href={`${base}&print=1`} className="btn ghost">
          Print all for {weekName(week)}
        </Link>
        <Link href={base} className="btn ghost">
          Save as PDF
        </Link>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void downloadTable(`pallet-manifests-week-of-${week}`, manifestsTable(list), "Manifest", "csv")}
        >
          Download CSV
        </button>
      </div>
      <p className="small muted m-0">
        Save as PDF opens every pallet&apos;s manifest; tap Save as PDF there and choose &ldquo;Save as PDF&rdquo; as the
        printer.
      </p>
    </div>
  );
}
