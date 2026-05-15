import Papa from "papaparse";
import type { BudgetLine, Category, MerchantRule, Purchase } from "./types";
import { newId } from "./types";
import type { ImportPatterns } from "./categorize";
import {
  buildPurchaseFromRow,
  categorizeDescription,
  inferColumnMap,
  inferSpendSign,
  pickColumn,
} from "./categorize";

function parseMoney(s: string): number {
  const cleaned = s.replace(/[$,\s]/g, "").replace(/[()]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export type SheetTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export async function readFileToTables(
  file: File,
  emptyWorkbookMessage: string,
): Promise<SheetTable[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });
    if (parsed.errors.length) {
      const msg = parsed.errors[0]?.message ?? "CSV parse error";
      throw new Error(msg);
    }
    const rows = (parsed.data ?? []).filter((r) =>
      Object.keys(r).some((k) => String(r[k]).trim()),
    );
    const headers =
      parsed.meta.fields?.map((h) => h.trim()) ?? Object.keys(rows[0] ?? {});
    return [{ headers, rows }];
  }

  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const tables: SheetTable[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
    if (json.length === 0) continue;
    const headers = Object.keys(json[0] ?? {}).map((h) => String(h).trim());
    const rows = json.map((obj) => {
      const rec: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        rec[String(k).trim()] = String(v ?? "").trim();
      }
      return rec;
    });
    tables.push({ headers, rows });
  }
  if (tables.length === 0) throw new Error(emptyWorkbookMessage);
  return tables;
}

function scoreBudgetHeader(h: string, headerScores: [string, number][]): number {
  const x = h.toLowerCase().trim();
  let s = 0;
  for (const [k, v] of headerScores) {
    if (x === k) s = Math.max(s, v);
    else if (x.includes(k)) s = Math.max(s, v * 0.7);
  }
  return s;
}

export function parseBudgetTable(
  table: SheetTable,
  categories: Category[],
  rules: MerchantRule[],
  sourceFileName: string,
  patterns: ImportPatterns,
  fallbackCategoryId: string,
): BudgetLine[] {
  const b = patterns.budget;
  const headers = table.headers;
  const scored = headers.map((h) => ({ h, s: scoreBudgetHeader(h, b.headerScores) }));
  scored.sort((a, b) => b.s - a.s);

  const catRegex = new RegExp(b.categoryHeaderRegex, "i");
  const amtRegex = new RegExp(b.amountHeaderRegex, "i");

  const categoryHeader =
    scored.find((x) => x.s >= b.categoryHeaderMinScore && catRegex.test(x.h))?.h ?? headers[0];
  const amountHeader =
    scored.find((x) => amtRegex.test(x.h) && x.h !== categoryHeader)?.h ??
    headers.find((h) => h !== categoryHeader) ??
    headers[1];

  if (!categoryHeader || !amountHeader) {
    throw new Error(b.errors.missingColumns);
  }

  const catKeys = [categoryHeader.toLowerCase().trim()];
  const amtKeys = [amountHeader.toLowerCase().trim()];

  const lines: BudgetLine[] = [];
  for (const row of table.rows) {
    const label = pickColumn(row, catKeys) ?? pickColumn(row, [categoryHeader]) ?? "";
    const rawAmt = pickColumn(row, amtKeys) ?? pickColumn(row, [amountHeader]);
    if (!label.trim()) continue;
    const amount = Math.abs(parseMoney(rawAmt ?? "0"));
    if (!Number.isFinite(amount) || amount === 0) continue;

    const categoryId = categorizeDescription(label, rules, categories, fallbackCategoryId, label);
    lines.push({
      id: newId(),
      categoryId,
      label: label.trim(),
      amount,
      sourceFileName,
    });
  }
  return lines;
}

export function parseTransactionTables(
  tables: SheetTable[],
  categories: Category[],
  rules: MerchantRule[],
  sourceFileName: string,
  patterns: ImportPatterns,
  fallbackCategoryId: string,
  emptyDescriptionLabel: string,
): Purchase[] {
  const purchases: Purchase[] = [];
  for (const table of tables) {
    if (table.rows.length === 0) continue;
    const columnMap = inferColumnMap(table.headers, patterns);
    const neg = inferSpendSign(table.rows, columnMap.amountKeys, patterns);
    for (const row of table.rows) {
      purchases.push(
        buildPurchaseFromRow({
          row,
          columnMap,
          sourceFileName,
          rules,
          categories,
          negativeMeansSpend: neg,
          patterns,
          fallbackCategoryId,
          emptyDescriptionLabel,
        }),
      );
    }
  }
  return purchases;
}
