"use client";

// P&L Setup: owners (Lucas, 11/17/26). The owners review the Weekly P&L:
// "Reviewed by" lists them, and only they see Review. An owner is a user, or
// a name for someone with no login yet; link the name to their user once
// they have one. Admins only.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { deleteOwner, loadOwners, saveOwner } from "@/lib/db/pnl";

async function loadAll(db: SupabaseClient) {
  const [owners, people] = await Promise.all([loadOwners(db), db.from("profiles").select("id, display_name, active").order("display_name")]);
  return {
    owners,
    people: ((people.data ?? []) as { id: string; display_name: string; active: boolean }[]).filter((x) => x.active !== false),
  };
}

export default function OwnersSetup() {
  const db = getDb();
  const toast = useToast();
  const load = useCallback((d: SupabaseClient) => loadAll(d), []);
  const { data, refresh } = useLive("pnl-owners", load, ["pnl_owners"]);
  const [name, setName] = useState("");
  const [user, setUser] = useState("");
  if (!data) return null;
  const after = (err: string | null, ok: string) => {
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
    return !err;
  };
  const free = data.people.filter((x) => !data.owners.some((o) => o.profile_id === x.id));
  const nameOf = (id: string | null) => data.people.find((x) => x.id === id)?.display_name ?? "";

  return (
    <section className="panel mt-3" aria-labelledby="pnl-owners">
      <h3 id="pnl-owners">Owners</h3>
      <p className="small muted mt-1">
        The owners review the Weekly P&amp;L: &quot;Reviewed by&quot; lists them, and only they see Review. Any admin can still
        close and reopen a week. Someone with no login yet is added by name; link them to their user once they have one.
      </p>
      <ul className="m-0 list-none p-0">
        {data.owners.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5">
            <b className="min-w-[10rem]">{o.name}</b>
            <label className="flex items-center gap-2 small">
              <span className="muted">Login</span>
              <select
                className="field"
                value={o.profile_id ?? ""}
                onChange={(e) => void saveOwner(db, { id: o.id, name: o.name, profileId: e.target.value || null }).then((err) => after(err, "Saved"))}
              >
                <option value="">No login yet</option>
                {[...(o.profile_id ? [{ id: o.profile_id, display_name: nameOf(o.profile_id) || "This user" }] : []), ...free].map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="copy min-h-[44px] px-2"
              onClick={() => {
                if (confirm(`Remove ${o.name} as an owner? Their past reviews stay in the history.`))
                  void deleteOwner(db, o.id).then((err) => after(err, `${o.name} removed`));
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim() || data.people.find((x) => x.id === user)?.display_name || "";
          if (!n) return toast("Pick a user or type a name");
          void saveOwner(db, { name: n, profileId: user || null, sort: data.owners.length + 1 }).then((err) => {
            if (after(err, `${n} is an owner`)) {
              setName("");
              setUser("");
            }
          });
        }}
      >
        <label className="grid gap-1">
          <span className="lbl m-0">User</span>
          <select className="field" value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">No login yet</option>
            {free.map((x) => (
              <option key={x.id} value={x.id}>
                {x.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[10rem] flex-1 gap-1">
          <span className="lbl m-0">Name (if no login)</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn ghost" disabled={!name.trim() && !user}>
          Add owner
        </button>
      </form>
    </section>
  );
}
