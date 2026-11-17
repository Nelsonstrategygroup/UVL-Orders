// A closed week's P&L, saved as it was shown (P&L stage C, Lucas 11/16/26).
// Money is kept in cents as bigint, which JSON can't hold: a bigint is saved
// as {"$big": "12345"} and read back as a bigint.

const TAG = "$big";

/** The P&L values as JSON the database can keep. */
export function toSnapshot(v: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? { [TAG]: x.toString() } : x)));
}

/** A saved snapshot read back, bigints and all. */
export function fromSnapshot<T>(v: unknown): T {
  return JSON.parse(JSON.stringify(v), (_k, x) => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const keys = Object.keys(x);
      if (keys.length === 1 && keys[0] === TAG && typeof x[TAG] === "string" && /^-?\d+$/.test(x[TAG])) return BigInt(x[TAG]);
    }
    return x;
  }) as T;
}
