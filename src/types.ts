export type Category = {
  id: string;
  name: string;
  color: string;
};

export type MerchantRule = {
  match: string;
  categoryId: string;
};

export type Purchase = {
  id: string;
  date: string;
  description: string;
  amount: number;
  /** Positive number representing spend attributed to this row. */
  spendAmount: number;
  categoryId: string;
  sourceFileName: string;
  rawRow: Record<string, string>;
};

export type BudgetLine = {
  id: string;
  categoryId: string;
  label: string;
  amount: number;
  sourceFileName: string;
};

/** Stored in `BudgetLine.sourceFileName` for lines created in the app (not from a file). */
export const MANUAL_BUDGET_SOURCE = "manual-entry";

export function isManualBudgetLine(b: BudgetLine): boolean {
  return b.sourceFileName === MANUAL_BUDGET_SOURCE || b.sourceFileName === "Manual entry";
}

export type AppState = {
  version: number;
  updatedAt: string;
  categories: Category[];
  merchantRules: MerchantRule[];
  purchases: Purchase[];
  budgets: BudgetLine[];
};

export function createEmptyState(
  version: number,
  categories: Category[],
  merchantRules: MerchantRule[],
): AppState {
  return {
    version,
    updatedAt: new Date().toISOString(),
    categories: [...categories],
    merchantRules: [...merchantRules],
    purchases: [],
    budgets: [],
  };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function slugCategoryIdBase(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "category";
}

/** Stable id from name; appends a short suffix if the base id is already taken. */
export function uniqueCategoryId(name: string, categories: Category[]): string {
  const base = slugCategoryIdBase(name);
  if (!categories.some((c) => c.id === base)) return base;
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${base}-${suffix}`;
}
