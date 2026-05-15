import type { Category, MerchantRule } from "../types";
import type { ImportPatterns } from "../categorize";

export type AppManifest = {
  localStorageKey: string;
  stateVersion: number;
  fallbackCategoryId: string;
  defaults: {
    categoriesUrl: string;
    merchantRulesUrl: string;
  };
  importPatterns: ImportPatterns;
  ui: Record<string, string>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`Manifest missing string: ${key}`);
  return v.trim();
}

function reqNum(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Manifest missing number: ${key}`);
  return v;
}

function reqStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new Error(`Manifest missing string[]: ${key}`);
  return v as string[];
}

function reqTupleScores(v: unknown): [string, number][] {
  if (!Array.isArray(v)) throw new Error("Manifest: budget.headerScores must be an array");
  return v.map((row, i) => {
    if (!Array.isArray(row) || row.length !== 2)
      throw new Error(`Manifest: budget.headerScores[${i}] must be [string, number]`);
    const [a, b] = row;
    if (typeof a !== "string" || typeof b !== "number")
      throw new Error(`Manifest: budget.headerScores[${i}] invalid types`);
    return [a, b] as [string, number];
  });
}

export function parseManifest(raw: unknown): AppManifest {
  if (!isRecord(raw)) throw new Error("Manifest must be a JSON object");

  const defaults = raw.defaults;
  if (!isRecord(defaults)) throw new Error("Manifest.defaults required");

  const ip = raw.importPatterns;
  if (!isRecord(ip)) throw new Error("Manifest.importPatterns required");

  const tc = ip.transactionColumns;
  const tr = ip.transactionRowFallback;
  if (!isRecord(tc) || !isRecord(tr)) throw new Error("Manifest importPatterns.transaction* required");

  const bud = ip.budget;
  const trx = ip.transactions;
  if (!isRecord(bud) || !isRecord(trx)) throw new Error("Manifest importPatterns.budget/transactions required");

  const budErr = bud.errors;
  const trxErr = trx.errors;
  if (!isRecord(budErr) || !isRecord(trxErr)) throw new Error("Manifest importPatterns.*.errors required");

  const spendInf = ip.spendSignInference;
  if (!isRecord(spendInf)) throw new Error("Manifest.importPatterns.spendSignInference required");

  const ui = raw.ui;
  if (!isRecord(ui)) throw new Error("Manifest.ui required");

  const importPatterns = {
    transactionColumns: {
      date: reqStringArray(tc, "date"),
      description: reqStringArray(tc, "description"),
      amount: reqStringArray(tc, "amount"),
      type: reqStringArray(tc, "type"),
      category: reqStringArray(tc, "category"),
    },
    transactionRowFallback: {
      description: reqStringArray(tr, "description"),
      date: reqStringArray(tr, "date"),
      amount: reqStringArray(tr, "amount"),
      type: reqStringArray(tr, "type"),
      bankCategory: reqStringArray(tr, "bankCategory"),
    },
    typeSpendZeroSubstrings: reqStringArray(ip, "typeSpendZeroSubstrings"),
    typeSpendSubstrings: reqStringArray(ip, "typeSpendSubstrings"),
    spendSignInference: {
      maxRows: reqNum(spendInf, "maxRows"),
      amountFallbackHeaders: reqStringArray(spendInf, "amountFallbackHeaders"),
    },
    budget: {
      headerScores: reqTupleScores(bud.headerScores),
      categoryHeaderMinScore: reqNum(bud, "categoryHeaderMinScore"),
      categoryHeaderRegex: reqString(bud, "categoryHeaderRegex"),
      amountHeaderRegex: reqString(bud, "amountHeaderRegex"),
      errors: {
        missingColumns: reqString(budErr, "missingColumns"),
      },
    },
    transactions: {
      errors: {
        emptyWorkbook: reqString(trxErr, "emptyWorkbook"),
      },
    },
  };

  const manifest: AppManifest = {
    localStorageKey: reqString(raw, "localStorageKey"),
    stateVersion: reqNum(raw, "stateVersion"),
    fallbackCategoryId: reqString(raw, "fallbackCategoryId"),
    defaults: {
      categoriesUrl: reqString(defaults, "categoriesUrl"),
      merchantRulesUrl: reqString(defaults, "merchantRulesUrl"),
    },
    importPatterns,
    ui: Object.fromEntries(
      Object.entries(ui).map(([k, v]) => {
        if (typeof v !== "string") throw new Error(`Manifest.ui.${k} must be a string`);
        return [k, v];
      }),
    ),
  };

  return manifest;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return (await res.json()) as T;
}

export function resolveAssetUrl(baseHref: string, ref: string): string {
  const r = ref.trim();
  if (r.startsWith("http://") || r.startsWith("https://")) return r;
  return new URL(r.replace(/^\//, ""), baseHref).href;
}

export type AppBootstrap = {
  manifest: AppManifest;
  initialCategories: Category[];
  initialMerchantRules: MerchantRule[];
};

export async function loadAppBootstrap(): Promise<AppBootstrap> {
  const baseHref = new URL(import.meta.env.BASE_URL, window.location.href).href;
  const envUrl = import.meta.env.VITE_RUNTIME_MANIFEST_URL?.trim();
  const manifestUrl =
    envUrl && envUrl.length > 0 ? envUrl : resolveAssetUrl(baseHref, "config/runtime.json");

  const manifestJson = await fetchJson<unknown>(manifestUrl);
  const manifest = parseManifest(manifestJson);

  const categoriesUrl = resolveAssetUrl(baseHref, manifest.defaults.categoriesUrl);
  const rulesUrl = resolveAssetUrl(baseHref, manifest.defaults.merchantRulesUrl);

  const [initialCategories, initialMerchantRules] = await Promise.all([
    fetchJson<Category[]>(categoriesUrl),
    fetchJson<MerchantRule[]>(rulesUrl),
  ]);

  if (!Array.isArray(initialCategories) || initialCategories.length === 0) {
    throw new Error("Categories file must be a non-empty array");
  }
  if (!Array.isArray(initialMerchantRules)) {
    throw new Error("Merchant rules file must be an array");
  }

  return { manifest, initialCategories, initialMerchantRules };
}
