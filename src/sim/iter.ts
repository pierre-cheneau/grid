// Sorted iteration helpers. The ONLY way `src/sim/` is allowed to iterate Maps.
//
// Why: JavaScript Map iteration is mostly insertion-ordered, but the future Python
// port has different defaults, and even within JavaScript a refactor can change the
// insertion order. Forcing every iteration through these helpers makes ordering
// deterministic by construction. See `docs/engineering/determinism-rules.md` Rule 4.
//
// The comparator is strict lexicographic on the raw string key. NEVER use
// `String.prototype.localeCompare` — it depends on the host locale and breaks
// determinism across platforms.

const lexCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Returns the keys of `m` in deterministic lexicographic order. */
export function sortedKeys<V>(m: ReadonlyMap<string, V>): string[] {
  return Array.from(m.keys()).sort(lexCompare);
}

/** Returns the entries of `m` in deterministic lexicographic key order. */
export function sortedEntries<V>(m: ReadonlyMap<string, V>): Array<[string, V]> {
  const keys = sortedKeys(m);
  const out: Array<[string, V]> = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] as string;
    out[i] = [k, m.get(k) as V];
  }
  return out;
}

/** Returns the values of `m` in deterministic lexicographic key order. */
export function sortedValuesByKey<V>(m: ReadonlyMap<string, V>): V[] {
  const keys = sortedKeys(m);
  const out: V[] = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    out[i] = m.get(keys[i] as string) as V;
  }
  return out;
}
