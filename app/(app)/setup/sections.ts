// Setup's pages (change request 10/21/26, stage 2): Setup opens to this list,
// and each opens its own page at /setup/<slug>.

export const SETUP_SECTIONS = [
  { slug: "products", title: "Products", sub: "What customers order, how, and what part of the lamb it comes from", area: "setup" },
  { slug: "boxes", title: "Boxes", sub: "How much of each product fits in each box, and the 45 lb cap", area: "setup" },
  { slug: "parts", title: "Parts per lamb", sub: "What one lamb gives you, and which parts set the lamb count", area: "setup" },
  { slug: "instructions", title: "Instructions for Mohawk", sub: "The cut sheet wording, and what each line counts as", area: "setup" },
  { slug: "sizes", title: "Lamb sizes", sub: "Size names and weights on the cut sheet", area: "setup" },
  { slug: "pallets", title: "Ships to", sub: "Who ships direct, and who ships through a distributor (PCC)", area: "setup" },
  { slug: "gtins", title: "Box labels (GTINs)", sub: "Which product each Mohawk box label is", area: "setup" },
  { slug: "le-trim", title: "Le Trim", sub: "Average shoulder and leg weights, to work out Le Trim by weight", area: "setup" },
  { slug: "prices", title: "Prices", sub: "Each product's price, and customer prices, from a date on", area: "prices" },
  { slug: "invoicing", title: "Invoicing", sub: "Invoice numbers, location codes, terms, and what prints on every invoice", area: "invoices" },
  { slug: "processor", title: "Processor", sub: "Name, email for cut sheets, instructions on every sheet", area: "setup" },
  // Was "Lamb cost" (SPEC 16.6: renamed in stage 3; the address stays /setup/lamb-cost).
  { slug: "lamb-cost", title: "P&L Setup", sub: "Producers and their pay, charges, and expense categories", adminOnly: true },
  { slug: "records", title: "Your records", sub: "Export all data to keep a copy", adminOnly: true },
] as const;

export type SetupSlug = (typeof SETUP_SECTIONS)[number]["slug"];

export function isSetupSlug(v: string): v is SetupSlug {
  return SETUP_SECTIONS.some((s) => s.slug === v);
}
