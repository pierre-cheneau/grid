// World size formula: diameter scales with yesterday's peak concurrent players.
// At v0.2 scale (≤100 players), the world stays small. At 10K+ players, it
// grows to 20K cells per side. The formula is `diameter = clamp(60, floor(20 * sqrt(peak)), 20000)`.

/** Compute the world diameter (in cells) from yesterday's peak concurrent player count. */
export function computeWorldDiameter(peak: number): number {
  if (peak <= 0) return 60;
  return Math.max(60, Math.min(20000, Math.floor(20 * Math.sqrt(peak))));
}
