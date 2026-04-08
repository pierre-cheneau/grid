// Tiny string hash used to derive a color seed from the player id.
//
// FNV-1a 32-bit. Pure, deterministic, ~10 lines. Good enough for "give two distinct
// strings two distinct colors with very high probability". Not cryptographic.

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
