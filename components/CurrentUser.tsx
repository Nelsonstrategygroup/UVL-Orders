"use client";

// Who is logged in, for screens that act differently on your own entries,
// and what they can see and change.

import { createContext, useContext } from "react";
import { can, type Area, type Perms, type Role } from "@/lib/auth/roles";

export type Me = { id: string; role: Role; displayName: string; perms: Perms };

const Ctx = createContext<Me | null>(null);

export function CurrentUserProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  return <Ctx.Provider value={me}>{children}</Ctx.Provider>;
}

export function useMe(): Me {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe must be used inside CurrentUserProvider");
  return v;
}

/** What the logged-in person can do in an area. */
export function useCan(area: Area): { view: boolean; change: boolean } {
  const me = useMe();
  return { view: can(me.perms, area, "view"), change: can(me.perms, area, "change") };
}
