"use client";

// Shared data for the office screens: the catalog (parts, products, sizes,
// settings) and the customer list. Loaded once after login and reloaded
// when a screen changes them.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCatalog, loadCustomers } from "@/lib/db/load";
import type { Catalog, CustomersData } from "@/lib/db/types";
import { getDb } from "./db";

type StaffDataValue = {
  db: SupabaseClient;
  catalog: Catalog | null;
  customers: CustomersData | null;
  error: string | null;
  reloadCatalog: () => Promise<void>;
  reloadCustomers: () => Promise<void>;
};

const Ctx = createContext<StaffDataValue | null>(null);

export { getDb } from "./db";

export function StaffDataProvider({ children }: { children: React.ReactNode }) {
  const db = getDb();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [customers, setCustomers] = useState<CustomersData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadCatalog = useCallback(async () => {
    try {
      setCatalog(await loadCatalog(db));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [db]);

  const reloadCustomers = useCallback(async () => {
    try {
      setCustomers(await loadCustomers(db));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [db]);

  useEffect(() => {
    let live = true;
    const fail = (e: unknown) => live && setError(e instanceof Error ? e.message : String(e));
    loadCatalog(db).then((c) => live && setCatalog(c), fail);
    loadCustomers(db).then((c) => live && setCustomers(c), fail);
    return () => {
      live = false;
    };
  }, [db]);

  const value = useMemo(
    () => ({ db, catalog, customers, error, reloadCatalog, reloadCustomers }),
    [db, catalog, customers, error, reloadCatalog, reloadCustomers],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStaffData(): StaffDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStaffData must be used inside StaffDataProvider");
  return v;
}
