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
