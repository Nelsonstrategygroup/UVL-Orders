// Distributor colors for the cross dock sheet and pallet labels (Lucas,
// 11/2/26): strong, print-safe colors, all dark enough for white type, so a
// color block prints as a solid dark block in black and white too. They differ
// in hue and in how dark they print; the short code tells them apart for sure.

export const DISTRIBUTOR_COLORS = [
  { hex: "#3B5E27", name: "Forest green" },
  { hex: "#7A3327", name: "Barn red" },
  { hex: "#1F3A5F", name: "Navy" },
  { hex: "#5B2A5E", name: "Plum" },
  { hex: "#0E5C5C", name: "Teal" },
  { hex: "#6B4A12", name: "Brown" },
  { hex: "#222222", name: "Black" },
] as const;

/** The first color no distributor uses yet (the list again once all are taken). */
export function nextDistributorColor(used: string[]): string {
  const taken = new Set(used.map((c) => c.toUpperCase()));
  return (DISTRIBUTOR_COLORS.find((c) => !taken.has(c.hex.toUpperCase())) ?? DISTRIBUTOR_COLORS[used.length % DISTRIBUTOR_COLORS.length]).hex;
}
