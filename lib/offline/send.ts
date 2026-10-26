// Uploading one outbox action to Supabase (SPEC 11.7), and sorting the result
// into: done, no signal (try later), login ran out, or refused (kept, shown).
// Every write is safe to repeat: weights and boxes carry the phone's client_id,
// marks and pallet notes are "set to this", GTINs and pallets are upserts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordBox } from "../db/scanning";
import { isAuthError, isNetworkError, type Action, type Outcome } from "./outbox";

type PgError = { message: string; code?: string; status?: number } | null;

const TIMEOUT_MS = 15000;

function classify(error: PgError, status?: number): Outcome {
  if (!error) return { kind: "done" };
  if (isNetworkError(error.message)) return { kind: "network" };
  if (isAuthError(error.message, status ?? error.status)) return { kind: "auth" };
  return { kind: "refused", message: error.message };
}

/** A slow upload in a dead spot counts as no signal; the action stays and is retried. */
function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("The request timed out")), TIMEOUT_MS)),
  ]);
}

export async function sendAction(db: SupabaseClient, a: Action): Promise<Outcome> {
  switch (a.type) {
    case "weight-add": {
      const r = await withTimeout(
        db.from("packing_weights").upsert(
          {
            client_id: a.client_id,
            order_id: a.order_id,
            product_id: a.product_id,
            weight: a.weight,
            box_no: a.box_no,
            slot: a.slot ?? null,
            label_no: a.label_no ?? null,
          },
          { onConflict: "client_id", ignoreDuplicates: true },
        ),
      );
      // The order was deleted while the phone was offline.
      if (r.error?.code === "23503") return { kind: "done", note: "A weight was for an order that no longer exists. Kathy should check it." };
      return classify(r.error, r.status);
    }
    case "weight-edit": {
      let query = db.from("packing_weights").update({ weight: a.weight, label_no: a.label_no });
      query = a.weight_id ? query.eq("id", a.weight_id) : query.eq("client_id", a.client_id ?? "");
      const r = await withTimeout(query);
      return classify(r.error, r.status);
    }
    case "weight-pallet": {
      let query = db.from("packing_weights").update({ pallet_id: a.pallet_id });
      query = a.weight_id ? query.eq("id", a.weight_id) : query.eq("client_id", a.client_id ?? "");
      const r = await withTimeout(query);
      return classify(r.error, r.status);
    }
    case "weight-remove": {
      let query = db.from("packing_weights").delete();
      query = a.weight_id ? query.eq("id", a.weight_id) : query.eq("client_id", a.client_id ?? "");
      const r = await withTimeout(query);
      return classify(r.error, r.status);
    }
    case "mark": {
      const m = a.mark;
      const r = await withTimeout(
        db.from("packing_lines").upsert(
          {
            order_id: a.order_id,
            product_id: a.product_id,
            packed_qty: m.count,
            shorted: m.shorted,
            flagged: m.flagged,
            flag_note: m.flagNote,
          },
          { onConflict: "order_id,product_id" },
        ),
      );
      if (r.error?.code === "23503") return { kind: "done", note: "A mark was for an order that no longer exists." };
      return classify(r.error, r.status);
    }
    case "pallet-text": {
      const r = await withTimeout(db.from("packing_orders").upsert({ order_id: a.order_id, pallet: a.pallet }, { onConflict: "order_id" }));
      if (r.error?.code === "23503") return { kind: "done" };
      return classify(r.error, r.status);
    }
    case "gtin-map": {
      const r = await withTimeout(db.from("gtin_products").upsert({ gtin: a.gtin, product_id: a.product_id }, { onConflict: "gtin" }));
      return classify(r.error, r.status);
    }
    case "pallet-add": {
      const r = await withTimeout(
        db
          .from("pallets")
          .upsert({ id: a.id, week_id: a.week_id, ship_date: a.ship_date, number: a.number, label: a.label }, { onConflict: "id", ignoreDuplicates: true }),
      );
      return classify(r.error, r.status);
    }
    case "pallet-start": {
      const r = await withTimeout(
        db.rpc("start_pallet", {
          p: { id: a.id, week_id: a.week_id, tag: a.tag, ship_to_customer_id: a.ship_to_customer_id, ship_to_point_id: a.ship_to_point_id, status: a.status ?? "open" },
        }),
      );
      return classify(r.error, r.status);
    }
    case "pallet-customer": {
      // One pallet per customer a week: take it off the week's other pallets first.
      const week = await withTimeout(db.from("pallets").select("id").eq("week_id", a.week_id));
      if (week.error) return classify(week.error, week.status);
      const ids = ((week.data ?? []) as { id: string }[]).map((p) => p.id);
      if (ids.length) {
        const off = await withTimeout(db.from("pallet_customers").delete().eq("customer_id", a.customer_id).in("pallet_id", ids));
        if (off.error) return classify(off.error, off.status);
      }
      if (!a.on) return { kind: "done" };
      const r = await withTimeout(db.from("pallet_customers").upsert({ pallet_id: a.pallet_id, customer_id: a.customer_id }, { onConflict: "pallet_id,customer_id", ignoreDuplicates: true }));
      // The pallet was deleted meanwhile.
      if (r.error?.code === "23503") return { kind: "done" };
      return classify(r.error, r.status);
    }
    case "pallet-delete": {
      // Only an empty pallet: a box may have gone on it from another phone meanwhile.
      const used = await withTimeout(db.from("packing_weights").select("id", { count: "exact", head: true }).eq("pallet_id", a.id));
      if (used.error) return classify(used.error, used.status);
      if ((used.count ?? 0) > 0) return { kind: "done", note: `${a.tag} has boxes on it now, so it wasn't deleted.` };
      const r = await withTimeout(db.from("pallets").delete().eq("id", a.id));
      return classify(r.error, r.status);
    }
    case "pallet-status": {
      const r = await withTimeout(db.from("pallets").update({ status: a.status }).eq("id", a.id));
      return classify(r.error, r.status);
    }
    case "box": {
      if (a.photo) {
        const up = await withTimeout(
          db.storage.from("box-photos").upload(a.photo.path, a.photo.blob, { contentType: a.photo.blob.type || "image/jpeg", upsert: false }),
        );
        // Sent before, then the signal dropped: the photo is already there.
        if (up.error && !/exists|duplicate/i.test(up.error.message)) {
          const o = classify({ message: up.error.message });
          if (o.kind !== "refused") return o;
          // The photo was refused; save the box without it rather than lose the box.
          a = { ...a, box: { ...a.box, photo_path: null }, photo: undefined };
        }
      }
      const r = await withTimeout(recordBox(db, a.box));
      if (r.status === "saved" || r.status === "already") return { kind: "done" };
      if (r.status === "duplicate")
        return { kind: "done", note: `A box was already packed for ${r.customer}, so it wasn't saved twice. Kathy will see it.` };
      if (r.status === "gone") return { kind: "done", note: "A box was for an order that no longer exists. Kathy will see it." };
      return classify({ message: r.message });
    }
  }
}
