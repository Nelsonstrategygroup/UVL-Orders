"use client";

// Holds the outbox (SPEC 11.7) and uploads it in the background: right after
// something is saved, when the phone comes back online, when the app comes
// back into view, and every 20 seconds while anything is waiting.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getDb } from "@/components/data/db";
import { keepStorage, outboxAdd, outboxAll, outboxDelete, outboxReplace } from "@/lib/offline/idb";
import { syncQueue, type Action, type Queued } from "@/lib/offline/outbox";
import { sendAction } from "@/lib/offline/send";

const EVERY_MS = 20000;

type OutboxValue = {
  queue: Queued[];
  /** Waiting to upload (not counting stuck ones). */
  waiting: number;
  stuck: Queued[];
  online: boolean;
  syncing: boolean;
  needLogin: boolean;
  /** Things worth telling the packer after an upload ("already packed for..."). */
  notes: string[];
  /** Goes up each time something uploads, so screens can reload. */
  uploaded: number;
  enqueue: (a: Action) => Promise<void>;
  syncNow: () => void;
  retry: (seq: number) => void;
  discard: (seq: number) => void;
  clearNotes: () => void;
  /** Loaders report whether the server answered. */
  reportOnline: (online: boolean) => void;
};

const Ctx = createContext<OutboxValue | null>(null);

export function OutboxProvider({ children }: { children: React.ReactNode }) {
  const db = getDb();
  const [queue, setQueue] = useState<Queued[]>([]);
  // Starts from what the phone says; loaders and uploads correct it.
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [syncing, setSyncing] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState(0);
  const running = useRef(false);
  const again = useRef(false);

  const syncNow = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        const items = await outboxAll();
        if (!items.some((q) => !q.stuck)) {
          setQueue(items);
          break;
        }
        setSyncing(true);
        const r = await syncQueue(items, (a) => sendAction(db, a));
        const left = new Set(r.queue.map((q) => q.seq));
        await outboxReplace(
          r.queue,
          items.filter((q) => !left.has(q.seq)).map((q) => q.seq),
        );
        setQueue(r.queue);
        setOnline(r.stoppedFor !== "network");
        setNeedLogin(r.stoppedFor === "auth");
        if (r.notes.length) setNotes((n) => [...n, ...r.notes]);
        if (r.sent) setUploaded((u) => u + 1);
      } while (again.current);
    } catch {
      // Storage or the network failed oddly; try again on the next tick.
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [db]);

  useEffect(() => {
    void keepStorage();
    void outboxAll()
      .then(setQueue)
      .then(() => syncNow())
      .catch(() => undefined);
    const onOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const onOffline = () => setOnline(false);
    const onShow = () => document.visibilityState === "visible" && void syncNow();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [syncNow]);

  const waiting = queue.filter((q) => !q.stuck).length;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void syncNow(), EVERY_MS);
    return () => clearInterval(t);
  }, [waiting, syncNow]);

  const enqueue = useCallback(
    async (a: Action) => {
      // On the phone first. Shown as saved only once it's stored.
      const q = await outboxAdd({ action: a, queuedAt: new Date().toISOString(), tries: 0 });
      setQueue((list) => [...list, q]);
      void syncNow();
    },
    [syncNow],
  );

  const retry = useCallback(
    (seq: number) => {
      void outboxAll().then(async (items) => {
        const q = items.find((x) => x.seq === seq);
        if (!q) return;
        await outboxReplace([{ ...q, stuck: false, lastError: undefined }], []);
        void syncNow();
      });
    },
    [syncNow],
  );

  const discard = useCallback((seq: number) => {
    void outboxDelete(seq).then(() => setQueue((list) => list.filter((q) => q.seq !== seq)));
  }, []);

  const value = useMemo<OutboxValue>(
    () => ({
      queue,
      waiting,
      stuck: queue.filter((q) => q.stuck),
      online,
      syncing,
      needLogin,
      notes,
      uploaded,
      enqueue,
      syncNow: () => void syncNow(),
      retry,
      discard,
      clearNotes: () => setNotes([]),
      reportOnline: setOnline,
    }),
    [queue, waiting, online, syncing, needLogin, notes, uploaded, enqueue, syncNow, retry, discard],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOutbox(): OutboxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOutbox must be used inside OutboxProvider");
  return v;
}
