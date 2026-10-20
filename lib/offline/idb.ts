// Storage on the phone (IndexedDB) for offline Packing (SPEC 11.7). Survives
// closing the app and restarting the phone. Two stores:
//   outbox     actions waiting to upload, by seq (oldest first)
//   snapshots  the last data loaded with signal, by key ("packing:2026-10-19")
// Browser only. IndexedDB keeps Maps and Blobs (photos) as they are.

import type { Queued } from "./outbox";

const DB_NAME = "uvl-offline";
const VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Ask the browser not to clear our storage when the phone is short of space. */
export async function keepStorage() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not supported; storage still works.
  }
}

// Outbox --------------------------------------------------------------------------

/** Add an action; returns it with its seq. Written before anything is shown as saved. */
export async function outboxAdd(item: Omit<Queued, "seq">): Promise<Queued> {
  const db = await open();
  const tx = db.transaction("outbox", "readwrite");
  const seq = (await done(tx.objectStore("outbox").add(item))) as number;
  await txDone(tx);
  return { ...item, seq };
}

export async function outboxAll(): Promise<Queued[]> {
  const db = await open();
  const all = (await done(db.transaction("outbox").objectStore("outbox").getAll())) as Queued[];
  return all.sort((a, b) => a.seq - b.seq);
}

/** Replace the stored queue with what's left after an upload (sent ones removed, tries and stuck updated). */
export async function outboxReplace(left: Queued[], sentOrGone: number[]) {
  const db = await open();
  const tx = db.transaction("outbox", "readwrite");
  const store = tx.objectStore("outbox");
  for (const seq of sentOrGone) store.delete(seq);
  for (const q of left) store.put(q);
  await txDone(tx);
}

export async function outboxDelete(seq: number) {
  const db = await open();
  const tx = db.transaction("outbox", "readwrite");
  tx.objectStore("outbox").delete(seq);
  await txDone(tx);
}

// Snapshots ----------------------------------------------------------------------

export type Snapshot<T> = { value: T; savedAt: string };

export async function snapshotSave<T>(key: string, value: T) {
  const db = await open();
  const tx = db.transaction("snapshots", "readwrite");
  tx.objectStore("snapshots").put({ value, savedAt: new Date().toISOString() } satisfies Snapshot<T>, key);
  await txDone(tx);
}

export async function snapshotGet<T>(key: string): Promise<Snapshot<T> | null> {
  const db = await open();
  return ((await done(db.transaction("snapshots").objectStore("snapshots").get(key))) as Snapshot<T> | undefined) ?? null;
}
