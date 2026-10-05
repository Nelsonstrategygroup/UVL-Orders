"use client";

// Who is logged in, for screens that act differently on your own entries.

import { createContext, useContext } from "react";
import type { Role } from "@/lib/auth/roles";

export type Me = { id: string; role: Role; displayName: string };

const Ctx = createContext<Me | null>(null);

export function CurrentUserProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  return <Ctx.Provider value={me}>{children}</Ctx.Provider>;
}

export function useMe(): Me {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe must be used inside CurrentUserProvider");
  return v;
}
