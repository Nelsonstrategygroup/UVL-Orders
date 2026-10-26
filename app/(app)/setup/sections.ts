// Setup's pages (change request 10/21/26, stage 2): Setup opens to this list,
// and each opens its own page at /setup/<slug>.

export const SETUP_SECTIONS = [
  { slug: "products", title: "Products", sub: "What customers order, how, and what part of the lamb it comes from" },
  { slug: "boxes", title: "Boxes", sub: "How much of each product fits in each box, and the 45 lb cap" },
  { slug: "parts", title: "Parts per lamb", sub: "What one lamb gives you, and which parts set the lamb count" },
  { slug: "instructions", title: "Instructions for Mohawk", sub: "The cut sheet wording, and what each line counts as" },
  { slug: "sizes", title: "Lamb sizes", sub: "Size names and weights on the cut sheet" },
  { slug: "pallets", title: "Ships to", sub: "Who ships direct, and who ships through a distributor (PCC)" },
  { slug: "gtins", title: "Box labels (GTINs)", sub: "Which product each Mohawk box label is" },
  { slug: "le-trim", title: "Le Trim", sub: "Trim per shoulder and per half leg, to estimate the trim Le Trim takes" },
  { slug: "processor", title: "Processor", sub: "Name, email for cut sheets, instructions on every sheet" },
  { slug: "records", title: "Your records", sub: "Export all data to keep a copy", adminOnly: true },
] as const;

export type SetupSlug = (typeof SETUP_SECTIONS)[number]["slug"];

export function isSetupSlug(v: string): v is SetupSlug {
  return SETUP_SECTIONS.some((s) => s.slug === v);
}
