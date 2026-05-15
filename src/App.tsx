import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppBootstrap } from "./runtime/manifest";
import type { AppState, BudgetLine, Category, Purchase } from "./types";
import { createEmptyState } from "./types";
import type { Persistence } from "./storage";
import {
  parseBudgetTable,
  parseTransactionTables,
  readFileToTables,
} from "./parseFile";

type Tab = "dashboard" | "transactions" | "budget" | "data";

function uiText(ui: Record<string, string>, key: string): string {
  const v = ui[key];
  if (typeof v !== "string") throw new Error(`Missing ui string key: ${key}`);
  return v;
}

function formatUi(
  ui: Record<string, string>,
  key: string,
  vars: Record<string, string | number>,
): string {
  return uiText(ui, key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function useAppState(
  bootstrap: AppBootstrap,
  persistence: Persistence,
): [AppState, (s: AppState) => void] {
  const { manifest, initialCategories, initialMerchantRules } = bootstrap;
  const [state, setState] = useState<AppState>(() => {
    return (
      persistence.loadStateFromLocalStorage() ??
      createEmptyState(manifest.stateVersion, initialCategories, initialMerchantRules)
    );
  });

  const persist = useCallback(
    (next: AppState) => {
      setState(next);
      persistence.saveStateToLocalStorage(next);
    },
    [persistence],
  );

  return [state, persist];
}

function sumBudgetByCategory(budgets: BudgetLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of budgets) {
    m.set(b.categoryId, (m.get(b.categoryId) ?? 0) + b.amount);
  }
  return m;
}

function sumSpendByCategory(purchases: Purchase[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of purchases) {
    m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + p.spendAmount);
  }
  return m;
}

export type AppProps = {
  bootstrap: AppBootstrap;
  persistence: Persistence;
};

export function App({ bootstrap, persistence }: AppProps) {
  const { manifest } = bootstrap;
  const ui = manifest.ui;
  const patterns = manifest.importPatterns;

  const [state, persist] = useAppState(bootstrap, persistence);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(t);
  }, [message]);

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of state.categories) m.set(c.id, c);
    return m;
  }, [state.categories]);

  const spendByCat = useMemo(() => sumSpendByCategory(state.purchases), [state.purchases]);
  const budgetByCat = useMemo(() => sumBudgetByCategory(state.budgets), [state.budgets]);

  const unknownColor = uiText(ui, "unknownCategoryColor");

  const dashboardRows = useMemo(() => {
    const ids = new Set<string>();
    for (const k of spendByCat.keys()) ids.add(k);
    for (const k of budgetByCat.keys()) ids.add(k);
    return [...ids].map((id) => {
      const spent = spendByCat.get(id) ?? 0;
      const budget = budgetByCat.get(id) ?? 0;
      const cat = categoryById.get(id);
      return {
        id,
        name: cat?.name ?? id,
        color: cat?.color ?? unknownColor,
        spent,
        budget,
        pct: budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0,
      };
    });
  }, [spendByCat, budgetByCat, categoryById, unknownColor]);

  const onTransactionsFile = async (file: File | null) => {
    if (!file) return;
    try {
      const tables = await readFileToTables(file, patterns.transactions.errors.emptyWorkbook);
      const parsed = parseTransactionTables(
        tables,
        state.categories,
        state.merchantRules,
        file.name,
        patterns,
        manifest.fallbackCategoryId,
        uiText(ui, "emptyDescription"),
      );
      persist({
        ...state,
        purchases: [...state.purchases, ...parsed],
      });
      setMessage({
        type: "ok",
        text: formatUi(ui, "msgImportedTransactions", { count: parsed.length, file: file.name }),
      });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const onBudgetFile = async (file: File | null) => {
    if (!file) return;
    try {
      const tables = await readFileToTables(file, patterns.transactions.errors.emptyWorkbook);
      const all: BudgetLine[] = [];
      for (const t of tables) {
        all.push(
          ...parseBudgetTable(
            t,
            state.categories,
            state.merchantRules,
            file.name,
            patterns,
            manifest.fallbackCategoryId,
          ),
        );
      }
      persist({
        ...state,
        budgets: all,
      });
      setMessage({
        type: "ok",
        text: formatUi(ui, "msgImportedBudget", { count: all.length, file: file.name }),
      });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const updatePurchaseCategory = (id: string, categoryId: string) => {
    persist({
      ...state,
      purchases: state.purchases.map((p) => (p.id === id ? { ...p, categoryId } : p)),
    });
  };

  const clearPurchases = () => {
    if (!window.confirm(uiText(ui, "confirmClearPurchases"))) return;
    persist({ ...state, purchases: [] });
    setMessage({ type: "ok", text: uiText(ui, "msgClearedPurchases") });
  };

  const clearBudgets = () => {
    if (!window.confirm(uiText(ui, "confirmClearBudget"))) return;
    persist({ ...state, budgets: [] });
    setMessage({ type: "ok", text: uiText(ui, "msgClearedBudget") });
  };

  const resetAll = () => {
    if (!window.confirm(uiText(ui, "confirmReset"))) return;
    persist(
      createEmptyState(
        manifest.stateVersion,
        bootstrap.initialCategories,
        bootstrap.initialMerchantRules,
      ),
    );
    setMessage({ type: "ok", text: uiText(ui, "msgReset") });
  };

  const onImportState = async (file: File | null) => {
    if (!file) return;
    try {
      const next = await persistence.parseStateJsonFile(file);
      persist(next);
      setMessage({
        type: "ok",
        text: formatUi(ui, "msgRestoredState", { file: file.name }),
      });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const dash = uiText(ui, "dashPlaceholder");
  const barTitleTemplate = uiText(ui, "labelPercentOfBudget");

  return (
    <>
      <header className="app-header">
        <div>
          <h1>{uiText(ui, "appTitle")}</h1>
          <p className="subtle">{uiText(ui, "appSubtitle")}</p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              persistence.downloadStateJson(state, uiText(ui, "exportFilename"))
            }
          >
            {uiText(ui, "downloadJson")}
          </button>
        </div>
      </header>

      {message && (
        <div className={`message ${message.type === "error" ? "error" : "ok"}`}>{message.text}</div>
      )}

      <div className="tabs" role="tablist" aria-label="Main">
        {(
          [
            ["dashboard", uiText(ui, "tabDashboard")],
            ["transactions", uiText(ui, "tabTransactions")],
            ["budget", uiText(ui, "tabBudget")],
            ["data", uiText(ui, "tabData")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <section className="panel" aria-label={uiText(ui, "tabDashboard")}>
          <h2>{uiText(ui, "dashboardTitle")}</h2>
          <p className="subtle">{uiText(ui, "dashboardHelp")}</p>
          {dashboardRows.length === 0 ? (
            <p className="subtle">{uiText(ui, "dashboardEmpty")}</p>
          ) : (
            dashboardRows
              .sort((a, b) => b.spent + b.budget - (a.spent + a.budget))
              .map((row) => (
                <div key={row.id} className="metric">
                  <div>
                    <div className="metric-title">
                      <span className="swatch" style={{ background: row.color }} />
                      {row.name}
                    </div>
                    <div className="legend">
                      {uiText(ui, "labelSpent")} <strong>${row.spent.toFixed(2)}</strong>
                      {row.budget > 0 && (
                        <>
                          {" "}
                          · {uiText(ui, "labelBudget")}{" "}
                          <strong>${row.budget.toFixed(2)}</strong> · {uiText(ui, "labelRemaining")}{" "}
                          <strong>${Math.max(0, row.budget - row.spent).toFixed(2)}</strong>
                        </>
                      )}
                      {row.budget <= 0 && row.spent > 0 && (
                        <> · {uiText(ui, "labelNoBudgetCategory")}</>
                      )}
                    </div>
                    <div
                      className="bar-track"
                      title={barTitleTemplate.replace("{pct}", `${row.pct.toFixed(0)}`)}
                    >
                      <div
                        className="bar-fill spent"
                        style={{ width: `${Math.min(100, row.pct)}%` }}
                      />
                    </div>
                  </div>
                  <div className="amount">{row.budget > 0 ? `${row.pct.toFixed(0)}%` : dash}</div>
                </div>
              ))
          )}
        </section>
      )}

      {tab === "transactions" && (
        <section className="panel">
          <h2>{uiText(ui, "transactionsImportTitle")}</h2>
          <p className="subtle">{uiText(ui, "transactionsImportHelp")}</p>
          <div className="row drop">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => void onTransactionsFile(e.target.files?.[0] ?? null)}
            />
            <button type="button" className="btn btn-danger" onClick={clearPurchases}>
              {uiText(ui, "clearPurchases")}
            </button>
          </div>

          <h2 style={{ marginTop: "1.25rem" }}>{uiText(ui, "purchasesTitle")}</h2>
          <p className="subtle">
            {state.purchases.length} {uiText(ui, "purchasesMeta")}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{uiText(ui, "thDate")}</th>
                  <th>{uiText(ui, "thDescription")}</th>
                  <th className="amount">{uiText(ui, "thAmount")}</th>
                  <th className="amount">{uiText(ui, "thSpend")}</th>
                  <th>{uiText(ui, "thCategory")}</th>
                  <th>{uiText(ui, "thSource")}</th>
                </tr>
              </thead>
              <tbody>
                {[...state.purchases]
                  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.date || dash}</td>
                      <td>{p.description}</td>
                      <td className="amount">{p.amount.toFixed(2)}</td>
                      <td className="amount">{p.spendAmount.toFixed(2)}</td>
                      <td>
                        <select
                          value={p.categoryId}
                          onChange={(e) => updatePurchaseCategory(p.id, e.target.value)}
                        >
                          {state.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="subtle">{p.sourceFileName}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "budget" && (
        <section className="panel">
          <h2>{uiText(ui, "budgetImportTitle")}</h2>
          <p className="subtle">{uiText(ui, "budgetImportHelp")}</p>
          <div className="row drop">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => void onBudgetFile(e.target.files?.[0] ?? null)}
            />
            <button type="button" className="btn" onClick={clearBudgets}>
              {uiText(ui, "clearBudget")}
            </button>
          </div>

          <h3 style={{ marginTop: "1rem" }}>{uiText(ui, "budgetLinesTitle")}</h3>
          <div className="table-wrap" style={{ maxHeight: 280 }}>
            <table>
              <thead>
                <tr>
                  <th>{uiText(ui, "thLabel")}</th>
                  <th>{uiText(ui, "thCategory")}</th>
                  <th className="amount">{uiText(ui, "thAmount")}</th>
                  <th>{uiText(ui, "thSource")}</th>
                </tr>
              </thead>
              <tbody>
                {state.budgets.map((b) => (
                  <tr key={b.id}>
                    <td>{b.label}</td>
                    <td>{categoryById.get(b.categoryId)?.name ?? b.categoryId}</td>
                    <td className="amount">{b.amount.toFixed(2)}</td>
                    <td className="subtle">{b.sourceFileName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "data" && (
        <section className="panel">
          <h2>{uiText(ui, "dataTitle")}</h2>
          <p className="subtle">{uiText(ui, "dataHelp")}</p>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                persistence.downloadStateJson(state, uiText(ui, "exportFilename"))
              }
            >
              {uiText(ui, "downloadStateJson")}
            </button>
            <label className="row">
              <span className="subtle">{uiText(ui, "restoreLabel")}</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => void onImportState(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <h3 style={{ marginTop: "1.25rem" }}>{uiText(ui, "dangerTitle")}</h3>
          <button type="button" className="btn btn-danger" onClick={resetAll}>
            {uiText(ui, "resetDefaults")}
          </button>
        </section>
      )}

      <footer className="subtle" style={{ marginTop: "2rem" }}>
        {uiText(ui, "footerLastSaved")} {new Date(state.updatedAt).toLocaleString()} ·{" "}
        {uiText(ui, "footerHosting")}
      </footer>
    </>
  );
}
