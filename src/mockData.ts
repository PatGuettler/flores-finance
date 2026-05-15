import type { BudgetLine, Category, Purchase } from "./types";
import { MANUAL_BUDGET_SOURCE, newId } from "./types";

const MOCK_PURCHASE_SOURCE = "mock-profile-data";

const MERCHANTS = [
  "Whole Foods Market",
  "Trader Joe's",
  "Shell",
  "Chevron",
  "Amazon.com",
  "AMZN Mktp",
  "Starbucks",
  "Chipotle",
  "Uber Eats",
  "DoorDash",
  "Netflix",
  "Spotify",
  "Apple.com/bill",
  "Target",
  "Walmart",
  "CVS Pharmacy",
  "Walgreens",
  "Home Depot",
  "Lowe's",
  "Delta Air",
  "United Airlines",
  "Marriott",
  "Lyft",
  "Uber",
  "Parking Meter",
  "City Utilities",
  "Comcast",
  "AT&T",
  "Planet Fitness",
  "REI",
  "Petco",
  "Dry Clean City",
  "Coffee Roasters",
  "Thai Bistro",
  "Sushi Den",
  "Gas Station #4421",
];

const BUDGET_LABELS = [
  "Monthly plan",
  "Adjusted target",
  "Q plan",
  "Household",
  "Trip buffer",
  "Rolling average",
  "Stretch goal",
  "Conservative",
];

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Builds a large set of purchases and budget lines for the current category list.
 * Does not mutate caller state.
 */
export function generateMockPurchasesAndBudgets(categories: Category[]): {
  purchases: Purchase[];
  budgets: BudgetLine[];
} {
  const spendCategories = categories.filter((c) => c.id !== "income");
  const pool = spendCategories.length > 0 ? spendCategories : categories;
  if (pool.length === 0) return { purchases: [], budgets: [] };

  const purchases: Purchase[] = [];
  const now = Date.now();
  const purchaseCount = 280;
  for (let i = 0; i < purchaseCount; i++) {
    const dayOffset = Math.floor(Math.random() * 150);
    const d = new Date(now - dayOffset * 86_400_000);
    const spend = Math.round((4 + Math.random() * 220) * 100) / 100;
    const cat = pick(pool);
    const merchant = pick(MERCHANTS);
    const suffix = i % 17 === 0 ? ` Store #${100 + i}` : "";
    const desc = `${merchant}${suffix}`.trim();
    const amount = -Math.abs(spend);
    const dateStr = isoDate(d);
    purchases.push({
      id: newId(),
      date: dateStr,
      description: desc,
      amount,
      spendAmount: spend,
      categoryId: cat.id,
      sourceFileName: MOCK_PURCHASE_SOURCE,
      rawRow: {
        date: dateStr,
        description: desc,
        amount: String(amount),
        category: cat.name,
      },
    });
  }

  const budgets: BudgetLine[] = [];
  const budgetLineCount = 95;
  for (let i = 0; i < budgetLineCount; i++) {
    const cat = pick(categories);
    const amt = Math.round((35 + Math.random() * 750) * 100) / 100;
    budgets.push({
      id: newId(),
      categoryId: cat.id,
      label: `${cat.name} — ${pick(BUDGET_LABELS)}`,
      amount: amt,
      sourceFileName: MANUAL_BUDGET_SOURCE,
    });
  }

  return { purchases, budgets };
}
