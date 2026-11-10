// Where a change came from, for the audit log's source column (11/10/26).
// Sent with each write as a request header; the database's audit trigger
// reads it (migration 20261110000100). Plain words, since people read the
// log: "weigh panel (Packing)", "scan", "give to (Pallets)".

export const SOURCE_HEADER = "x-uvl-action";

/** A Supabase write carrying where it came from. */
export function withSource<T extends { setHeader: (name: string, value: string) => T }>(q: T, source: string): T {
  return q.setHeader(SOURCE_HEADER, source);
}
