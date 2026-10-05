// GET /api/export: every table as CSV in one zip (SPEC 5.10). Admins only.
// Reads with the admin's own session, so RLS still applies (admins can read
// every table); the service role key isn't needed.

import JSZip from "jszip";
import { getCurrentUser } from "@/lib/auth/current-user";
import { todayISO } from "@/lib/dates";
import { EXPORT_TABLES, exportReadme, toCsv } from "@/lib/export";
import { createClient } from "@/lib/supabase/server";

const PAGE = 1000;

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return new Response("Only an admin can export all data.", { status: 403 });
  }

  const db = await createClient();
  const zip = new JSZip();
  const counts: { table: string; rows: number }[] = [];

  for (const { table, order } of EXPORT_TABLES) {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = db.from(table).select("*");
      for (const col of order) q = q.order(col);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) {
        return new Response(`Couldn't read ${table}: ${error.message}`, { status: 500 });
      }
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if (!data || data.length < PAGE) break;
    }
    zip.file(`${table}.csv`, toCsv(rows));
    counts.push({ table, rows: rows.length });
  }

  const date = todayISO();
  zip.file("README.txt", exportReadme(date, counts));
  const body = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="uvl-orders-export-${date}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
