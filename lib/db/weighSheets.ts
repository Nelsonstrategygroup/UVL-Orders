// Weigh sheet data (SPEC 16.3, Lamb cost stage 2): Mohawk's kill log, one
// sheet per producer per kill date, every lamb's carcass weight, adjustments
// and photos of the paper sheet. Admins only (Row Level Security). Loaded
// with plain queries, never embeds (kill_adjustments links to both sheets
// and lambs). Nothing else in the app reads these tables.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdjustmentKind, AdjustmentReason, KillAdjustment, KillLamb, KillSheet } from "../calc/lambCost";
import { withSource } from "./source";

export type KillSheetPhoto = { id: string; sheet_id: string; path: string; created_at: string };

export type SheetData = {
  sheets: KillSheet[];
  lambs: KillLamb[];
  adjustments: KillAdjustment[];
  photos: KillSheetPhoto[];
};

const SHEET_COLS = "id, producer_id, kill_date, week_id, base_rate, live_factor, rate_source, notes";
const SRC = "weigh sheet";

/** Database errors in plain words. */
export function plain(e: { message: string; code?: string; hint?: string } | null): string | null {
  if (!e) return null;
  // The database's message names the page by its old name ("Lamb cost").
  if (/^No pricing setting starts on or before/.test(e.message)) return e.message.replace("Setup > Lamb cost", "Setup > P&L Setup");
  if (e.code === "23505" && /kill_sheets/.test(e.message)) return "That producer already has a sheet for that kill date.";
  if (e.code === "23505" && /kill_lambs/.test(e.message)) return "That place on the sheet already has a weight.";
  if (e.code === "23503" && /kill_adjustments/.test(e.message)) return "This lamb has an adjustment. Remove the adjustment first.";
  if (e.code === "23503" && /producers/.test(e.message)) return "This producer has weigh sheets, so they can only be turned off.";
  if (e.code === "23514" && /note/.test(e.message)) return "Type a note for \"Other\".";
  if (e.code === "23514" && /carcass_lb/.test(e.message)) return "A weight is more than 0 and less than 500 lb.";
  if (e.code === "42501") return "Only an admin can change this.";
  return e.message;
}

async function rowsFor(db: SupabaseClient, sheetIds: string[]): Promise<Omit<SheetData, "sheets">> {
  if (!sheetIds.length) return { lambs: [], adjustments: [], photos: [] };
  const [l, a, p] = await Promise.all([
    db.from("kill_lambs").select("id, sheet_id, position, carcass_lb").in("sheet_id", sheetIds).order("position"),
    db.from("kill_adjustments").select("id, sheet_id, lamb_id, kind, amount, reason, note").in("sheet_id", sheetIds).order("created_at"),
    db.from("kill_sheet_photos").select("id, sheet_id, path, created_at").in("sheet_id", sheetIds).order("created_at"),
  ]);
  const err = l.error ?? a.error ?? p.error;
  if (err) throw new Error(err.message);
  return {
    lambs: (l.data ?? []) as KillLamb[],
    adjustments: (a.data ?? []) as KillAdjustment[],
    photos: (p.data ?? []) as KillSheetPhoto[],
  };
}

/** A week's sheets (by packing Monday) and everything on them. */
export async function loadWeekSheets(db: SupabaseClient, week: string): Promise<SheetData> {
  const { data, error } = await db.from("kill_sheets").select(SHEET_COLS).eq("week_id", week).order("kill_date").order("created_at");
  if (error) throw new Error(error.message);
  const sheets = (data ?? []) as KillSheet[];
  return { sheets, ...(await rowsFor(db, sheets.map((s) => s.id))) };
}

/** One sheet and everything on it; sheets is empty if it's gone. */
export async function loadSheet(db: SupabaseClient, id: string): Promise<SheetData> {
  const { data, error } = await db.from("kill_sheets").select(SHEET_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { sheets: [], lambs: [], adjustments: [], photos: [] };
  return { sheets: [data as KillSheet], ...(await rowsFor(db, [id])) };
}

/** A new sheet; the database stores the rate and factor for its kill date. Returns its id. */
export async function createSheet(db: SupabaseClient, producerId: string, killDate: string): Promise<{ id?: string; error: string | null }> {
  const { data, error } = await withSource(
    db.from("kill_sheets").insert({ producer_id: producerId, kill_date: killDate }).select("id").single(),
    SRC,
  );
  return { id: (data as { id: string } | null)?.id, error: plain(error) };
}

/** Change a sheet's producer, kill date or notes. A new producer or date takes Setup's rates for it. */
export async function updateSheet(
  db: SupabaseClient,
  id: string,
  change: Partial<{ producer_id: string; kill_date: string; notes: string }>,
): Promise<string | null> {
  const { error } = await withSource(db.from("kill_sheets").update(change).eq("id", id), SRC);
  return plain(error);
}

/** Take the rates again from Setup for the sheet's kill date. Logged. */
export async function applySetupRates(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.rpc("use_setup_rates", { p_sheet: id });
  return plain(error);
}

/** Delete a sheet with its weights, adjustments and photos (files first). Everything is in the audit log. */
export async function deleteSheet(db: SupabaseClient, id: string, photoPaths: string[]): Promise<string | null> {
  if (photoPaths.length) {
    const { error } = await db.storage.from("kill-sheets").remove(photoPaths);
    if (error) return error.message;
  }
  const { error } = await withSource(db.from("kill_sheets").delete().eq("id", id), SRC);
  return plain(error);
}

/** Put a weight at a place on the sheet: a new lamb, or a change (the old value goes in the audit log). */
export async function setWeight(db: SupabaseClient, sheetId: string, position: number, carcassLb: string): Promise<string | null> {
  const { error } = await withSource(
    db.from("kill_lambs").upsert({ sheet_id: sheetId, position, carcass_lb: carcassLb }, { onConflict: "sheet_id,position" }),
    SRC,
  );
  return plain(error);
}

export async function deleteWeight(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await withSource(db.from("kill_lambs").delete().eq("id", id), SRC);
  return plain(error);
}

export async function addAdjustment(
  db: SupabaseClient,
  a: { sheetId: string; lambId: string | null; kind: AdjustmentKind; amount: string; reason: AdjustmentReason; note: string },
): Promise<string | null> {
  const { error } = await withSource(
    db.from("kill_adjustments").insert({
      sheet_id: a.sheetId,
      lamb_id: a.lambId,
      kind: a.kind,
      amount: a.amount,
      reason: a.reason,
      note: a.note.trim(),
    }),
    SRC,
  );
  return plain(error);
}

export async function deleteAdjustment(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await withSource(db.from("kill_adjustments").delete().eq("id", id), SRC);
  return plain(error);
}

/** Upload a photo of the paper sheet (already shrunk) and record it. */
export async function addSheetPhoto(db: SupabaseClient, sheetId: string, photo: Blob): Promise<string | null> {
  const path = `${sheetId}/${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from("kill-sheets").upload(path, photo, { contentType: photo.type || "image/jpeg", upsert: false });
  if (up.error) return up.error.message;
  const { error } = await withSource(db.from("kill_sheet_photos").insert({ sheet_id: sheetId, path }), SRC);
  if (error) await db.storage.from("kill-sheets").remove([path]);
  return plain(error);
}

export async function deleteSheetPhoto(db: SupabaseClient, photo: KillSheetPhoto): Promise<string | null> {
  const { error: fileErr } = await db.storage.from("kill-sheets").remove([photo.path]);
  if (fileErr) return fileErr.message;
  const { error } = await withSource(db.from("kill_sheet_photos").delete().eq("id", photo.id), SRC);
  return plain(error);
}

/** Links to look at the photos (good for an hour). */
export async function photoLinks(db: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data, error } = await db.storage.from("kill-sheets").createSignedUrls(paths, 3600);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
}
