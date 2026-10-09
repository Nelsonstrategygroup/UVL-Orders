// Turns reference/seed-data.json into rows for each table, in insert order.
// Pure: no database access. scripts/seed.ts writes the rows.

export type SeedPart = {
  id: string;
  name: string;
  per_lamb: number;
  unit: "each" | "lb";
  balance_check: boolean;
  confirmed: boolean;
  source_note: string;
  sort: number;
};

export type SeedCutSpec = {
  id: string;
  text: string;
  use_type: string;
  active: boolean;
  sort: number;
};

export type SeedProduct = {
  id: string;
  name: string;
  short_name: string;
  unit: string;
  group_name: string;
  cut_spec_id: string | null;
  fresh_only: boolean;
  active: boolean;
  sort: number;
  note: string;
  part_uses: { part: string; qty: number }[];
};

export type SeedSizeClass = { id: string; label: string; weight_range: string; sort: number };

export type SeedLine = {
  kind: "line" | "note";
  cut_spec_id: string | null;
  qty: number | null;
  text: string | null;
  side_note: string;
  highlight: "yellow" | "blue" | "green" | null;
  shank_on: boolean;
  sort: number;
};

export type SeedSet = {
  name: string;
  lambs: number;
  size_class_id: string;
  headline: string;
  sort: number;
  lines: SeedLine[];
};

export type SeedData = {
  parts: SeedPart[];
  cut_specs: SeedCutSpec[];
  products: SeedProduct[];
  size_classes: SeedSizeClass[];
  saving_goals: { text: string; active: boolean }[];
  processor: { name: string; email: string; standing_instructions: string };
  sample_cut_sheet: {
    week_id: string;
    process_date: string;
    inv_number: string;
    banners: string[];
    notes: string;
    sets: SeedSet[];
  };
};

export function buildSeed(data: SeedData, newId: () => string = () => crypto.randomUUID()) {
  const parts = data.parts.map((p) => ({ ...p }));
  const cut_specs = data.cut_specs.map((s) => ({ ...s }));
  const products = data.products.map((p) => {
    const row: Omit<SeedProduct, "part_uses"> & { part_uses?: unknown } = { ...p };
    delete row.part_uses;
    // These are copies of Mohawk's cut lines. Customers order from the
    // customer products (seed_customer_products in the migrations); these stay
    // off, for history.
    row.active = false;
    return row as Omit<SeedProduct, "part_uses">;
  });
  const product_part_uses = data.products.flatMap((p) =>
    p.part_uses.map((u) => ({ product_id: p.id, part_id: u.part, qty: u.qty })),
  );
  const size_classes = data.size_classes.map((s) => ({ ...s }));
  const saving_goals = data.saving_goals.map((g) => ({ ...g }));

  const sheet = data.sample_cut_sheet;
  const week = { id: sheet.week_id, process_date: sheet.process_date };
  const cut_sheet = { week_id: sheet.week_id, inv_number: sheet.inv_number, notes: sheet.notes };
  const banners = sheet.banners.map((text, sort) => ({ week_id: sheet.week_id, text, sort }));
  const sets: {
    id: string;
    week_id: string;
    name: string;
    lambs: number;
    size_class_id: string;
    headline: string;
    sort: number;
  }[] = [];
  const lines: (SeedLine & { set_id: string })[] = [];
  for (const s of sheet.sets) {
    const id = newId();
    sets.push({
      id,
      week_id: sheet.week_id,
      name: s.name,
      lambs: s.lambs,
      size_class_id: s.size_class_id,
      headline: s.headline,
      sort: s.sort,
    });
    for (const l of s.lines) lines.push({ set_id: id, ...l });
  }

  return {
    catalog: { parts, cut_specs, products, product_part_uses, size_classes },
    saving_goals,
    processor: data.processor,
    sample: { week, cut_sheet, banners, sets, lines },
  };
}

export type SeedPlan = ReturnType<typeof buildSeed>;
