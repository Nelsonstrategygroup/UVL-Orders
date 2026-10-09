// Save downloads on this device: text (CSV) or a spreadsheet table as CSV or
// Excel, in the file type picked on the Downloads page.

import { useEffect, useState } from "react";
import type { Table } from "@/lib/reports";
import { tableCsv } from "@/lib/reports";

function save(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save text as a file on this device. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  save(filename, new Blob([text], { type }));
}

export type FileType = "csv" | "xlsx";
export const FILE_TYPE_LABEL: Record<FileType, string> = { csv: "CSV", xlsx: "Excel" };
const KEY = "uvl:fileType";

/** The file type picked on the Downloads page (this device only). CSV unless Excel was picked. */
export function getFileType(): FileType {
  try {
    return localStorage.getItem(KEY) === "xlsx" ? "xlsx" : "csv";
  } catch {
    return "csv";
  }
}

/** The picked file type, and a way to change it (remembered on this device). */
export function useFileType(): [FileType, (t: FileType) => void] {
  const [type, setType] = useState<FileType>("csv");
  useEffect(() => {
    // Read once after the page loads (there's no storage on the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setType(getFileType());
  }, []);
  const set = (t: FileType) => {
    setType(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // Not remembered; fine.
    }
  };
  return [type, set];
}

/**
 * Save a table as base.csv or base.xlsx. `sheet` names the Excel tab.
 * Without a type, uses the one picked on the Downloads page.
 */
export async function downloadTable(base: string, t: Table, sheet: string, type: FileType = getFileType()) {
  if (type === "xlsx") {
    const { xlsxFile, XLSX_TYPE } = await import("@/lib/xlsx");
    const bytes = await xlsxFile([{ name: sheet, header: t.header, rows: t.rows }]);
    save(`${base}.xlsx`, new Blob([bytes as BlobPart], { type: XLSX_TYPE }));
  } else {
    downloadText(`${base}.csv`, tableCsv(t));
  }
}
