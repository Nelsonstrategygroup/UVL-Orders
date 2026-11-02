"use client";

// Open and Download for the Weigh Sheet and the Pallet Sheet on Print and
// download (Lucas, 11/1/26). The download is the same rows as the printout,
// built from the week's packing data (as on Packing).

import Link from "next/link";
import { downloadTable, type FileType } from "@/components/download";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import { sheetLabels } from "@/lib/db/packing";
import { palletCustomers, palletTable, weighSections, weighTable } from "@/lib/packSheets";
import { invFileName } from "@/lib/weekInv";

export default function PackSheetButtons({ week, kind, fileType }: { week: string; kind: "weigh" | "pallet"; fileType: FileType }) {
  const bundle = usePackingBundle(week);
  const toast = useToast();
  const href = kind === "weigh" ? "/packing/weigh" : "/packing/print";

  async function download() {
    const b = bundle.data;
    if (!b) return;
    const labels = sheetLabels(b.packing, b.boxes);
    const inv = b.packing.invNumber;
    try {
      if (kind === "weigh") await downloadTable(invFileName(inv, "Weigh Sheet", week), weighTable(weighSections(b.packing, labels), inv, week), "Weigh Sheet", fileType);
      else await downloadTable(invFileName(inv, "Pallet Sheet", week), palletTable(palletCustomers(b.packing, labels), inv, week), "Pallet Sheet", fileType);
    } catch {
      toast("Couldn't download. Try again.");
    }
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Link href={href} className="btn">
        Open
      </Link>
      <button type="button" className="btn ghost" disabled={!bundle.data} onClick={() => void download()}>
        {bundle.data ? "Download" : "Loading..."}
      </button>
    </div>
  );
}
