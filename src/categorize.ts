import type { Category, MerchantRule, Purchase } from "./types";
import { newId } from "./types";

export type ImportPatterns = {
  transactionColumns: {
    date: string[];
    description: string[];
    amount: string[];
    type: string[];
    category: string[];
  };
  transactionRowFallback: {
    description: string[];
    date: string[];
    amount: string[];
    type: string[];
    bankCategory: string[];
  };
  typeSpendZeroSubstrings: string[];
  typeSpendSubstrings: string[];
  spendSignInference: { maxRows: number; amountFallbackHeaders: string[] };
  budget: {
    headerScores: [string, number][];
    categoryHeaderMinScore: number;
    categoryHeaderRegex: string;
    amountHeaderRegex: string;
    errors: { missingColumns: string };
  };
  transactions: {
    errors: { emptyWorkbook: string };
  };
};

export type ColumnMap = {
  dateKeys: string[];
  descriptionKeys: string[];
  amountKeys: string[];
  typeKeys: string[];
  categoryKeys: string[];
};

function normalizeText(s: string): string {
  return s.toLowerCase().trim();
}

export function resolveCategoryFromBankColumn(
  bankCategory: string | undefined,
  categories: Category[],
): string | undefined {
  if (!bankCategory) return undefined;
  const n = normalizeText(bankCategory);
  const direct = categories.find((c) => normalizeText(c.name) === n);
  if (direct) return direct.id;
  const partial = categories.find(
    (c) => n.includes(normalizeText(c.name)) || normalizeText(c.name).includes(n),
  );
  return partial?.id;
}

export function categorizeDescription(
  description: string,
  rules: MerchantRule[],
  categories: Category[],
  fallbackCategoryId: string,
  bankCategory?: string,
): string {
  const fromBank = resolveCategoryFromBankColumn(bankCategory, categories);
  if (fromBank) return fromBank;

  const d = normalizeText(description);
  for (const rule of rules) {
    if (d.includes(normalizeText(rule.match))) {
      if (categories.some((c) => c.id === rule.categoryId)) {
        return rule.categoryId;
      }
    }
  }
  const fb = categories.find((c) => c.id === fallbackCategoryId);
  return fb?.id ?? categories[0]?.id ?? fallbackCategoryId;
}

export function pickColumn(row: Record<string, string>, keys: string[]): string | undefined {
  const lowerRow = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]),
  );
  for (const key of keys) {
    const v = lowerRow[key.toLowerCase()];
    if (v !== undefined && String(v).trim() !== "") return String(v);
  }
  return undefined;
}

function parseMoney(s: string): number {
  const cleaned = s.replace(/[$,\s]/g, "").replace(/[()]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDateString(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return t;
}

function scoreHeader(header: string, candidates: string[]): number {
  const h = header.toLowerCase().trim();
  let best = 0;
  for (const c of candidates) {
    if (h === c) best = Math.max(best, 100);
    else if (h.includes(c)) best = Math.max(best, 50);
    else if (c.includes(h) && h.length > 2) best = Math.max(best, 25);
  }
  return best;
}

export function inferColumnMap(headers: string[], p: ImportPatterns): ColumnMap {
  const pick = (cands: string[]): string[] => {
    const scored = headers.map((h) => ({ h, s: scoreHeader(h, cands) }));
    scored.sort((a, b) => b.s - a.s);
    return scored.filter((x) => x.s > 0).map((x) => x.h.toLowerCase().trim());
  };

  return {
    dateKeys: pick(p.transactionColumns.date),
    descriptionKeys: pick(p.transactionColumns.description),
    amountKeys: pick(p.transactionColumns.amount),
    typeKeys: pick(p.transactionColumns.type),
    categoryKeys: pick(p.transactionColumns.category),
  };
}

export function inferSpendSign(
  rows: Record<string, string>[],
  amountKeys: string[],
  p: ImportPatterns,
): boolean {
  const maxRows = p.spendSignInference.maxRows;
  const amounts: number[] = [];
  for (const row of rows.slice(0, maxRows)) {
    const raw =
      pickColumn(row, amountKeys) ?? pickColumn(row, p.spendSignInference.amountFallbackHeaders);
    if (raw) amounts.push(parseMoney(raw));
  }
  if (amounts.length === 0) return true;
  const negatives = amounts.filter((n) => n < 0).length;
  return negatives >= amounts.filter((n) => n > 0).length;
}

function typeContainsAny(typeCol: string, tokens: string[]): boolean {
  return tokens.some((t) => typeCol.includes(t));
}

export function buildPurchaseFromRow(params: {
  row: Record<string, string>;
  columnMap: ColumnMap;
  sourceFileName: string;
  rules: MerchantRule[];
  categories: Category[];
  negativeMeansSpend: boolean;
  patterns: ImportPatterns;
  fallbackCategoryId: string;
  emptyDescriptionLabel: string;
}): Purchase {
  const {
    row,
    columnMap,
    sourceFileName,
    rules,
    categories,
    negativeMeansSpend,
    patterns,
    fallbackCategoryId,
    emptyDescriptionLabel,
  } = params;
  const fb = patterns.transactionRowFallback;

  const description =
    pickColumn(row, columnMap.descriptionKeys) ??
    pickColumn(row, fb.description) ??
    "";

  const dateRaw =
    pickColumn(row, columnMap.dateKeys) ?? pickColumn(row, fb.date) ?? "";

  const date = normalizeDateString(dateRaw);

  const amountRaw =
    pickColumn(row, columnMap.amountKeys) ?? pickColumn(row, fb.amount);

  const amount = parseMoney(amountRaw ?? "0");

  const typeCol =
    pickColumn(row, columnMap.typeKeys)?.toLowerCase() ??
    pickColumn(row, fb.type)?.toLowerCase();

  let spendAmount = Math.abs(amount);
  if (typeCol) {
    if (typeContainsAny(typeCol, patterns.typeSpendZeroSubstrings)) {
      spendAmount = 0;
    } else if (typeContainsAny(typeCol, patterns.typeSpendSubstrings)) {
      spendAmount = Math.abs(amount);
    }
  } else if (negativeMeansSpend) {
    spendAmount = amount < 0 ? Math.abs(amount) : 0;
  } else {
    spendAmount = amount > 0 ? Math.abs(amount) : 0;
  }

  const bankCategory =
    pickColumn(row, columnMap.categoryKeys) ?? pickColumn(row, fb.bankCategory);

  const categoryId = categorizeDescription(
    description,
    rules,
    categories,
    fallbackCategoryId,
    bankCategory,
  );

  return {
    id: newId(),
    date,
    description: description.trim() || emptyDescriptionLabel,
    amount,
    spendAmount,
    categoryId,
    sourceFileName,
    rawRow: row,
  };
}
