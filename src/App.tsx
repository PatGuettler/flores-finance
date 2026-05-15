import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppBootstrap } from "./runtime/manifest";
import type { AppState, BudgetLine, Category, Purchase } from "./types";
import {
  createEmptyState,
  newId,
  uniqueCategoryId,
  MANUAL_BUDGET_SOURCE,
  isManualBudgetLine,
} from "./types";
import { recategorizePurchases } from "./categorize";
import type { Persistence } from "./storage";
import {
  parseBudgetTable,
  parseTransactionTables,
  readFileToTables,
} from "./parseFile";
import { ProfileMenu, ProfileMenuTrigger } from "./ProfileMenu";
import {
  applyUserSettingsToDocument,
  loadUserSettings,
  saveUserSettings,
  type UserSettings,
} from "./userSettings";

type Tab = "dashboard" | "transactions" | "budget" | "data";

type BudgetLinesSubTab = "planned" | "unplanned";

const ADD_CATEGORY_SELECT_VALUE = "__add_category__";

type CategoryQuickAdd =
  | { kind: "none" }
  | { kind: "purchase"; purchaseId: string; prevCategoryId: string }
  | { kind: "budget"; prevCategoryId: string };

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

function isUserAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  return e instanceof Error && e.name === "AbortError";
}

async function downloadPublicSample(path: string, filename: string): Promise<void> {
  const baseHref = new URL(import.meta.env.BASE_URL, window.location.href).href;
  const url = new URL(path.replace(/^\//, ""), baseHref).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${filename} (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

function IconPencil() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.83H5v-.92l8.06-8.06.92.92L5.92 20.08zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
      />
    </svg>
  );
}

function useAppState(
  bootstrap: AppBootstrap,
  persistence: Persistence,
  initialAppState?: AppState,
): [AppState, (next: AppState | ((prev: AppState) => AppState)) => void] {
  const { manifest, initialCategories, initialMerchantRules } = bootstrap;
  const [state, setState] = useState<AppState>(() => {
    if (initialAppState !== undefined) return initialAppState;
    return (
      persistence.loadStateFromLocalStorage() ??
      createEmptyState(manifest.stateVersion, initialCategories, initialMerchantRules)
    );
  });

  const persist = useCallback(
    (next: AppState | ((prev: AppState) => AppState)) => {
      setState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        persistence.saveStateToLocalStorage(resolved);
        return resolved;
      });
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
  /** When set, used as the first snapshot (e.g. state read from a linked JSON workspace file). */
  initialAppState?: AppState;
};

export function App({ bootstrap, persistence, initialAppState }: AppProps) {
  const { manifest } = bootstrap;
  const ui = manifest.ui;
  const patterns = manifest.importPatterns;

  const [state, persist] = useAppState(bootstrap, persistence, initialAppState);
  const [linkedWorkspaceFileName, setLinkedWorkspaceFileName] = useState<string | null>(() =>
    persistence.getLinkedWorkspaceFileName(),
  );
  const [tab, setTab] = useState<Tab>("dashboard");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(
    null,
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings>(() => loadUserSettings());
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#6366f1");
  const [budgetLineCategoryId, setBudgetLineCategoryId] = useState("");
  const [budgetLineAmount, setBudgetLineAmount] = useState("");
  const [budgetLineLabel, setBudgetLineLabel] = useState("");
  const [categoryQuickAdd, setCategoryQuickAdd] = useState<CategoryQuickAdd>({ kind: "none" });
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddColor, setQuickAddColor] = useState("#6366f1");
  const [editingBudgetLineId, setEditingBudgetLineId] = useState<string | null>(null);
  const [editBudgetDraft, setEditBudgetDraft] = useState<{
    categoryId: string;
    label: string;
    amount: string;
  }>({ categoryId: "", label: "", amount: "" });
  const budgetAmountInputRef = useRef<HTMLInputElement>(null);
  const [budgetLinesSubTab, setBudgetLinesSubTab] = useState<BudgetLinesSubTab>("planned");

  useEffect(() => {
    setCategoryQuickAdd({ kind: "none" });
    setQuickAddName("");
    setQuickAddColor("#6366f1");
    setEditingBudgetLineId(null);
    setBudgetLinesSubTab("planned");
  }, [tab]);

  useEffect(() => {
    saveUserSettings(userSettings);
    applyUserSettingsToDocument(userSettings);
  }, [userSettings]);

  useEffect(() => {
    if (userSettings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => {
      document.documentElement.dataset.theme = mq.matches ? "light" : "dark";
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [userSettings.theme]);

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

  const categoriesEligibleForBudgetLine = useMemo(() => {
    const used = new Set(state.budgets.map((b) => b.categoryId));
    return state.categories.filter((c) => !used.has(c.id));
  }, [state.categories, state.budgets]);

  const categoriesForBudgetLineEdit = useMemo(() => {
    if (!editingBudgetLineId) return state.categories;
    return state.categories.filter(
      (c) => !state.budgets.some((b) => b.categoryId === c.id && b.id !== editingBudgetLineId),
    );
  }, [state.categories, state.budgets, editingBudgetLineId]);

  useEffect(() => {
    if (categoriesEligibleForBudgetLine.length === 0) {
      setBudgetLineCategoryId("");
      return;
    }
    setBudgetLineCategoryId((id) =>
      id && categoriesEligibleForBudgetLine.some((c) => c.id === id)
        ? id
        : categoriesEligibleForBudgetLine[0]!.id,
    );
  }, [categoriesEligibleForBudgetLine]);

  useEffect(() => {
    if (budgetLinesSubTab === "unplanned" && categoriesEligibleForBudgetLine.length === 0) {
      setBudgetLinesSubTab("planned");
    }
  }, [budgetLinesSubTab, categoriesEligibleForBudgetLine.length]);

  const spendByCat = useMemo(() => sumSpendByCategory(state.purchases), [state.purchases]);
  const budgetByCat = useMemo(() => sumBudgetByCategory(state.budgets), [state.budgets]);

  const unknownColor = uiText(ui, "unknownCategoryColor");

  const appendCategoryToState = (
    base: AppState,
    name: string,
    color: string,
    assignPurchaseId?: string,
  ): { next: AppState; newId: string } | null => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const c = color.trim() || unknownColor;
    const id = uniqueCategoryId(trimmed, base.categories);
    const cat: Category = { id, name: trimmed, color: c };
    const nextCategories = [...base.categories, cat];
    let nextPurchases = recategorizePurchases(
      base.purchases,
      base.merchantRules,
      nextCategories,
      patterns,
      manifest.fallbackCategoryId,
    );
    if (assignPurchaseId) {
      nextPurchases = nextPurchases.map((p) =>
        p.id === assignPurchaseId ? { ...p, categoryId: id } : p,
      );
    }
    return {
      next: { ...base, categories: nextCategories, purchases: nextPurchases },
      newId: id,
    };
  };

  const dashboardRows = useMemo(() => {
    const ids = new Set<string>();
    for (const c of state.categories) ids.add(c.id);
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
  }, [spendByCat, budgetByCat, categoryById, unknownColor, state.categories]);

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
      persist((prev) => ({
        ...prev,
        purchases: [...prev.purchases, ...parsed],
      }));
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
      persist((prev) => ({
        ...prev,
        budgets: [...prev.budgets.filter((b) => isManualBudgetLine(b)), ...all],
      }));
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
    persist((prev) => ({
      ...prev,
      purchases: prev.purchases.map((p) => (p.id === id ? { ...p, categoryId } : p)),
    }));
  };

  const addUserCategory = () => {
    const built = appendCategoryToState(state, newCategoryName, newCategoryColor);
    if (!built) {
      setMessage({ type: "error", text: uiText(ui, "errCategoryNameRequired") });
      return;
    }
    persist((prev) => {
      const b = appendCategoryToState(prev, newCategoryName, newCategoryColor);
      if (!b) return prev;
      return b.next;
    });
    setNewCategoryName("");
    setMessage({
      type: "ok",
      text: formatUi(ui, "msgAddedCategory", { name: newCategoryName.trim() }),
    });
  };

  const cancelQuickCategoryAdd = () => {
    setCategoryQuickAdd({ kind: "none" });
    setQuickAddName("");
    setQuickAddColor("#6366f1");
  };

  const submitQuickCategoryAdd = () => {
    const kind = categoryQuickAdd.kind;
    const assignPurchaseId = kind === "purchase" ? categoryQuickAdd.purchaseId : undefined;
    const built = appendCategoryToState(state, quickAddName, quickAddColor, assignPurchaseId);
    if (!built) {
      setMessage({ type: "error", text: uiText(ui, "errCategoryNameRequired") });
      return;
    }
    let newBudgetCatId: string | undefined;
    persist((prev) => {
      const b = appendCategoryToState(prev, quickAddName, quickAddColor, assignPurchaseId);
      if (!b) return prev;
      if (kind === "budget") newBudgetCatId = b.newId;
      return b.next;
    });
    if (newBudgetCatId) setBudgetLineCategoryId(newBudgetCatId);
    const addedName = quickAddName.trim();
    cancelQuickCategoryAdd();
    setMessage({
      type: "ok",
      text: formatUi(ui, "msgAddedCategory", { name: addedName }),
    });
  };

  const addManualBudgetLine = () => {
    const raw = budgetLineAmount.replace(/[$,\s]/g, "").trim();
    const amt = Number.parseFloat(raw);
    if (!Number.isFinite(amt) || amt <= 0) {
      setMessage({ type: "error", text: uiText(ui, "errBudgetAmountInvalid") });
      return;
    }
    if (!budgetLineCategoryId) {
      setMessage({ type: "error", text: uiText(ui, "errBudgetNoCategory") });
      return;
    }
    if (state.budgets.some((b) => b.categoryId === budgetLineCategoryId)) {
      setMessage({
        type: "error",
        text: formatUi(ui, "errBudgetLineExists", {
          name: categoryById.get(budgetLineCategoryId)?.name ?? budgetLineCategoryId,
        }),
      });
      return;
    }
    const cat = categoryById.get(budgetLineCategoryId);
    const label =
      budgetLineLabel.trim() || cat?.name || uiText(ui, "budgetAddLabelFallback");
    const line: BudgetLine = {
      id: newId(),
      categoryId: budgetLineCategoryId,
      label,
      amount: amt,
      sourceFileName: MANUAL_BUDGET_SOURCE,
    };
    persist((prev) => ({
      ...prev,
      budgets: [...prev.budgets, line],
    }));
    setBudgetLineAmount("");
    setBudgetLineLabel("");
    setMessage({ type: "ok", text: uiText(ui, "msgAddedBudgetLine") });
  };

  const planBudgetForCategory = (categoryId: string) => {
    setBudgetLineCategoryId(categoryId);
    window.requestAnimationFrame(() => {
      budgetAmountInputRef.current?.focus();
      budgetAmountInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const cancelEditBudgetLine = () => {
    setEditingBudgetLineId(null);
    setEditBudgetDraft({ categoryId: "", label: "", amount: "" });
  };

  const startEditBudgetLine = (b: BudgetLine) => {
    setCategoryQuickAdd({ kind: "none" });
    setQuickAddName("");
    setQuickAddColor("#6366f1");
    setEditingBudgetLineId(b.id);
    setEditBudgetDraft({
      categoryId: b.categoryId,
      label: b.label,
      amount: String(b.amount),
    });
  };

  const saveEditBudgetLine = () => {
    if (!editingBudgetLineId) return;
    const line = state.budgets.find((x) => x.id === editingBudgetLineId);
    if (!line) {
      cancelEditBudgetLine();
      return;
    }
    const raw = editBudgetDraft.amount.replace(/[$,\s]/g, "").trim();
    const amt = Number.parseFloat(raw);
    if (!Number.isFinite(amt) || amt <= 0) {
      setMessage({ type: "error", text: uiText(ui, "errBudgetAmountInvalid") });
      return;
    }
    if (!editBudgetDraft.categoryId) {
      setMessage({ type: "error", text: uiText(ui, "errBudgetNoCategory") });
      return;
    }
    if (
      state.budgets.some(
        (b) => b.categoryId === editBudgetDraft.categoryId && b.id !== editingBudgetLineId,
      )
    ) {
      setMessage({
        type: "error",
        text: formatUi(ui, "errBudgetLineExists", {
          name: categoryById.get(editBudgetDraft.categoryId)?.name ?? editBudgetDraft.categoryId,
        }),
      });
      return;
    }
    const cat = categoryById.get(editBudgetDraft.categoryId);
    const label =
      editBudgetDraft.label.trim() || cat?.name || uiText(ui, "budgetAddLabelFallback");
    persist((prev) => ({
      ...prev,
      budgets: prev.budgets.map((b) =>
        b.id === editingBudgetLineId
          ? { ...b, categoryId: editBudgetDraft.categoryId, label, amount: amt }
          : b,
      ),
    }));
    cancelEditBudgetLine();
    setMessage({ type: "ok", text: uiText(ui, "msgSavedBudgetLine") });
  };

  const deleteBudgetLine = (id: string) => {
    if (!window.confirm(uiText(ui, "confirmDeleteBudgetLine"))) return;
    persist((prev) => ({
      ...prev,
      budgets: prev.budgets.filter((b) => b.id !== id),
    }));
    if (editingBudgetLineId === id) cancelEditBudgetLine();
    setMessage({ type: "ok", text: uiText(ui, "msgDeletedBudgetLine") });
  };

  const canDeleteCategoryWithZeroSpend = (categoryId: string): boolean =>
    categoryId !== manifest.fallbackCategoryId && (spendByCat.get(categoryId) ?? 0) <= 0;

  const deleteCategoryWithZeroSpend = (categoryId: string) => {
    if (categoryId === manifest.fallbackCategoryId) {
      setMessage({ type: "error", text: uiText(ui, "errCannotDeleteFallbackCategory") });
      return;
    }
    const spent = spendByCat.get(categoryId) ?? 0;
    if (spent > 0) {
      setMessage({
        type: "error",
        text: formatUi(ui, "errCannotDeleteCategoryWithSpend", {
          amount: spent.toFixed(2),
        }),
      });
      return;
    }
    const name = categoryById.get(categoryId)?.name ?? categoryId;
    if (!window.confirm(formatUi(ui, "confirmDeleteCategory", { name }))) return;

    if (editingBudgetLineId) {
      const bl = state.budgets.find((x) => x.id === editingBudgetLineId);
      if (bl?.categoryId === categoryId) cancelEditBudgetLine();
    }
    if (categoryQuickAdd.kind === "budget" && categoryQuickAdd.prevCategoryId === categoryId) {
      setCategoryQuickAdd({ kind: "none" });
    }

    const fb = manifest.fallbackCategoryId;
    persist((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c.id !== categoryId),
      merchantRules: prev.merchantRules.filter((r) => r.categoryId !== categoryId),
      purchases: prev.purchases.map((p) =>
        p.categoryId === categoryId ? { ...p, categoryId: fb } : p,
      ),
      budgets: prev.budgets.filter((b) => b.categoryId !== categoryId),
    }));
    setMessage({ type: "ok", text: formatUi(ui, "msgDeletedCategory", { name }) });
  };

  const clearPurchases = () => {
    if (!window.confirm(uiText(ui, "confirmClearPurchases"))) return;
    persist((prev) => ({ ...prev, purchases: [] }));
    setMessage({ type: "ok", text: uiText(ui, "msgClearedPurchases") });
  };

  const clearBudgets = () => {
    if (!window.confirm(uiText(ui, "confirmClearBudget"))) return;
    persist((prev) => ({ ...prev, budgets: [] }));
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

  const downloadDemo = async (path: string, filename: string) => {
    try {
      await downloadPublicSample(path, filename);
      setMessage({
        type: "ok",
        text: formatUi(ui, "msgDownloadedDemo", { file: filename }),
      });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
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

  const budgetLinesNewestFirst = useMemo(
    () => [...state.budgets].slice().reverse(),
    [state.budgets],
  );

  const quickCategoryAddBlock =
    categoryQuickAdd.kind === "purchase" || categoryQuickAdd.kind === "budget" ? (
      <div
        className="category-quick-add drop"
        role="region"
        aria-label={uiText(ui, "categoryQuickAddAria")}
      >
        <h3 className="category-quick-add-title">{uiText(ui, "categoryQuickAddTitle")}</h3>
        <p className="subtle category-quick-add-help">
          {categoryQuickAdd.kind === "purchase"
            ? uiText(ui, "categoryQuickAddHelpTransaction")
            : uiText(ui, "categoryQuickAddHelpBudget")}
        </p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="profile-field" style={{ flex: "1 1 180px" }}>
            <span>{uiText(ui, "addCategoryName")}</span>
            <input
              type="text"
              value={quickAddName}
              onChange={(e) => setQuickAddName(e.target.value)}
              placeholder={uiText(ui, "addCategoryNamePlaceholder")}
            />
          </label>
          <label className="profile-field" style={{ flex: "0 0 auto" }}>
            <span>{uiText(ui, "addCategoryColor")}</span>
            <input
              type="color"
              value={quickAddColor}
              onChange={(e) => setQuickAddColor(e.target.value)}
              aria-label={uiText(ui, "addCategoryColor")}
              style={{
                width: "3rem",
                height: "2.25rem",
                padding: 0,
                border: "1px solid var(--border)",
                borderRadius: 8,
                cursor: "pointer",
                background: "transparent",
              }}
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={submitQuickCategoryAdd}>
            {uiText(ui, "addCategoryButton")}
          </button>
          <button type="button" className="btn" onClick={cancelQuickCategoryAdd}>
            {uiText(ui, "categoryQuickAddCancel")}
          </button>
        </div>
      </div>
    ) : null;

  return (
    <>
      <header className="app-header">
        <div className="app-header-main">
          <h1>{uiText(ui, "appTitle")}</h1>
          <p className="subtle">{uiText(ui, "appSubtitle")}</p>
        </div>
        <div className="app-header-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              persistence.downloadStateJson(state, uiText(ui, "exportFilename"))
            }
          >
            {uiText(ui, "downloadJson")}
          </button>
          <ProfileMenuTrigger
            ui={ui}
            expanded={profileOpen}
            onClick={() => setProfileOpen((o) => !o)}
          />
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
          {categoryQuickAdd.kind === "purchase" && quickCategoryAddBlock}
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
                          value={
                            categoryQuickAdd.kind === "purchase" &&
                            categoryQuickAdd.purchaseId === p.id
                              ? categoryQuickAdd.prevCategoryId
                              : p.categoryId
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === ADD_CATEGORY_SELECT_VALUE) {
                              setCategoryQuickAdd({
                                kind: "purchase",
                                purchaseId: p.id,
                                prevCategoryId: p.categoryId,
                              });
                              setQuickAddName("");
                              setQuickAddColor(newCategoryColor);
                              return;
                            }
                            updatePurchaseCategory(p.id, v);
                          }}
                        >
                          {state.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                          <option value={ADD_CATEGORY_SELECT_VALUE}>
                            {uiText(ui, "selectAddCategoryOption")}
                          </option>
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

          <h3 style={{ marginTop: "1.25rem" }}>{uiText(ui, "budgetAddLineTitle")}</h3>
          <p className="subtle">{uiText(ui, "budgetAddLineHelp")}</p>
          {categoriesEligibleForBudgetLine.length === 0 && state.categories.length > 0 && (
            <p className="subtle" style={{ marginBottom: "0.5rem" }}>
              {uiText(ui, "budgetAddAllCategoriesHaveLines")}
            </p>
          )}
          {categoryQuickAdd.kind === "budget" && quickCategoryAddBlock}
          <div className="row drop">
            <label className="profile-field" style={{ minWidth: 200, flex: "1 1 160px" }}>
              <span>{uiText(ui, "thCategory")}</span>
              <select
                value={
                  categoryQuickAdd.kind === "budget"
                    ? categoryQuickAdd.prevCategoryId || budgetLineCategoryId
                    : budgetLineCategoryId
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === ADD_CATEGORY_SELECT_VALUE) {
                    setCategoryQuickAdd({
                      kind: "budget",
                      prevCategoryId: budgetLineCategoryId,
                    });
                    setQuickAddName("");
                    setQuickAddColor("#6366f1");
                    return;
                  }
                  setBudgetLineCategoryId(v);
                }}
              >
                {categoriesEligibleForBudgetLine.length === 0 ? (
                  <option value="" disabled>
                    {uiText(ui, "budgetAddNoEligibleCategory")}
                  </option>
                ) : null}
                {categoriesEligibleForBudgetLine.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={ADD_CATEGORY_SELECT_VALUE}>
                  {uiText(ui, "selectAddCategoryOption")}
                </option>
              </select>
            </label>
            <label className="profile-field" style={{ minWidth: 120, flex: "0 1 120px" }}>
              <span>{uiText(ui, "budgetAddAmount")}</span>
              <input
                ref={budgetAmountInputRef}
                id="budget-line-amount-input"
                type="text"
                inputMode="decimal"
                value={budgetLineAmount}
                onChange={(e) => setBudgetLineAmount(e.target.value)}
                placeholder={uiText(ui, "budgetAddAmountPlaceholder")}
              />
            </label>
            <label className="profile-field" style={{ minWidth: 160, flex: "1 1 140px" }}>
              <span>{uiText(ui, "budgetAddLabel")}</span>
              <input
                type="text"
                value={budgetLineLabel}
                onChange={(e) => setBudgetLineLabel(e.target.value)}
                placeholder={uiText(ui, "budgetAddLabelPlaceholder")}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                categoriesEligibleForBudgetLine.length === 0 || !budgetLineCategoryId
              }
              onClick={addManualBudgetLine}
            >
              {uiText(ui, "budgetAddButton")}
            </button>
          </div>

          <h3 style={{ marginTop: "1rem" }}>{uiText(ui, "budgetLinesTitle")}</h3>
          <p className="subtle" style={{ marginBottom: "0.65rem" }}>
            {uiText(ui, "budgetLinesIntro")}
          </p>
          <div
            className="tabs budget-lines-tabs"
            role="tablist"
            aria-label={uiText(ui, "budgetLinesSubTabsAria")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={budgetLinesSubTab === "planned"}
              className="tab"
              onClick={() => setBudgetLinesSubTab("planned")}
            >
              {uiText(ui, "budgetLinesTabPlanned")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={budgetLinesSubTab === "unplanned"}
              className="tab"
              onClick={() => setBudgetLinesSubTab("unplanned")}
            >
              {uiText(ui, "budgetLinesTabUnplanned")}
            </button>
          </div>
          {budgetLinesSubTab === "planned" ? (
            <div className="table-wrap budget-lines-table">
              <table>
                <thead>
                  <tr>
                    <th>{uiText(ui, "thLabel")}</th>
                    <th>{uiText(ui, "thCategory")}</th>
                    <th className="amount">{uiText(ui, "thAmount")}</th>
                    <th>{uiText(ui, "thSource")}</th>
                    <th className="budget-actions-col">{uiText(ui, "thBudgetActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.budgets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="subtle">
                        {uiText(ui, "budgetLinesEmpty")}
                      </td>
                    </tr>
                  ) : (
                    budgetLinesNewestFirst.map((b) =>
                      editingBudgetLineId === b.id ? (
                        <tr key={b.id}>
                          <td>
                            <input
                              type="text"
                              className="budget-edit-input"
                              value={editBudgetDraft.label}
                              onChange={(e) =>
                                setEditBudgetDraft((d) => ({ ...d, label: e.target.value }))
                              }
                              aria-label={uiText(ui, "thLabel")}
                            />
                          </td>
                          <td>
                            <select
                              value={editBudgetDraft.categoryId}
                              onChange={(e) =>
                                setEditBudgetDraft((d) => ({
                                  ...d,
                                  categoryId: e.target.value,
                                }))
                              }
                              aria-label={uiText(ui, "thCategory")}
                            >
                              {categoriesForBudgetLineEdit.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="amount">
                            <input
                              type="text"
                              inputMode="decimal"
                              className="budget-edit-input budget-edit-amount"
                              value={editBudgetDraft.amount}
                              onChange={(e) =>
                                setEditBudgetDraft((d) => ({ ...d, amount: e.target.value }))
                              }
                              aria-label={uiText(ui, "budgetAddAmount")}
                            />
                          </td>
                          <td className="subtle">
                            {isManualBudgetLine(b)
                              ? uiText(ui, "manualBudgetSource")
                              : b.sourceFileName}
                          </td>
                          <td>
                            <div className="budget-actions">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={saveEditBudgetLine}
                              >
                                {uiText(ui, "saveBudgetLineEdit")}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={cancelEditBudgetLine}
                              >
                                {uiText(ui, "cancelBudgetLineEdit")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={b.id}>
                          <td>{b.label}</td>
                          <td>{categoryById.get(b.categoryId)?.name ?? b.categoryId}</td>
                          <td className="amount">{b.amount.toFixed(2)}</td>
                          <td className="subtle">
                            {isManualBudgetLine(b)
                              ? uiText(ui, "manualBudgetSource")
                              : b.sourceFileName}
                          </td>
                          <td>
                            <div className="budget-actions">
                              <button
                                type="button"
                                className="btn-icon"
                                onClick={() => startEditBudgetLine(b)}
                                disabled={
                                  editingBudgetLineId !== null && editingBudgetLineId !== b.id
                                }
                                aria-label={uiText(ui, "editBudgetLineAria")}
                                title={uiText(ui, "editBudgetLineAria")}
                              >
                                <IconPencil />
                              </button>
                              <button
                                type="button"
                                className="btn-icon btn-icon-danger"
                                onClick={() => deleteBudgetLine(b.id)}
                                aria-label={uiText(ui, "deleteBudgetLineAria")}
                                title={uiText(ui, "deleteBudgetLineAria")}
                              >
                                <IconTrash />
                              </button>
                              {canDeleteCategoryWithZeroSpend(b.categoryId) ? (
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => deleteCategoryWithZeroSpend(b.categoryId)}
                                  title={uiText(ui, "deleteCategoryZeroSpendAria")}
                                >
                                  {uiText(ui, "deleteCategoryZeroSpendButton")}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    )
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-wrap budget-lines-table">
              <table>
                <thead>
                  <tr>
                    <th>{uiText(ui, "thLabel")}</th>
                    <th>{uiText(ui, "thCategory")}</th>
                    <th className="amount">{uiText(ui, "thAmount")}</th>
                    <th>{uiText(ui, "thSource")}</th>
                    <th className="budget-actions-col">{uiText(ui, "thBudgetActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriesEligibleForBudgetLine.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="subtle">
                        {uiText(ui, "budgetUnplannedTabEmpty")}
                      </td>
                    </tr>
                  ) : (
                    categoriesEligibleForBudgetLine.map((c) => (
                      <tr key={`unplanned-${c.id}`} className="budget-unplanned-row">
                        <td className="subtle">{uiText(ui, "budgetUnplannedLabelCell")}</td>
                        <td>{c.name}</td>
                        <td className="amount subtle">{uiText(ui, "dashPlaceholder")}</td>
                        <td className="subtle">{uiText(ui, "budgetUnplannedSource")}</td>
                        <td>
                          <div className="budget-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => planBudgetForCategory(c.id)}
                            >
                              {uiText(ui, "budgetPlanAmount")}
                            </button>
                            {canDeleteCategoryWithZeroSpend(c.id) ? (
                              <button
                                type="button"
                                className="btn-icon btn-icon-danger"
                                onClick={() => deleteCategoryWithZeroSpend(c.id)}
                                aria-label={uiText(ui, "deleteCategoryZeroSpendAria")}
                                title={uiText(ui, "deleteCategoryZeroSpendAria")}
                              >
                                <IconTrash />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "data" && (
        <section className="panel">
          <h2>{uiText(ui, "dataTitle")}</h2>
          <p className="subtle">{uiText(ui, "dataHelp")}</p>
          {persistence.isWorkspaceFilePersistenceAvailable() ? (
            <>
              <h3 style={{ marginTop: "1.25rem" }}>{uiText(ui, "dataWorkspaceFileTitle")}</h3>
              <p className="subtle">{uiText(ui, "dataWorkspaceFileHelp")}</p>
              {linkedWorkspaceFileName ? (
                <p className="subtle">
                  {formatUi(ui, "dataWorkspaceLinkedStatus", { name: linkedWorkspaceFileName })}
                </p>
              ) : (
                <p className="subtle">{uiText(ui, "dataWorkspaceNotLinked")}</p>
              )}
              <div className="row" style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void (async () => {
                      try {
                        const next = await persistence.linkExistingWorkspaceFile();
                        persist(next);
                        setLinkedWorkspaceFileName(persistence.getLinkedWorkspaceFileName());
                        setMessage({ type: "ok", text: uiText(ui, "msgLinkedWorkspaceExisting") });
                      } catch (e) {
                        if (isUserAbortError(e)) return;
                        setMessage({
                          type: "error",
                          text: formatUi(ui, "errWorkspaceFilePick", {
                            detail: e instanceof Error ? e.message : String(e),
                          }),
                        });
                      }
                    })()
                  }
                >
                  {uiText(ui, "dataWorkspaceLinkExisting")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void (async () => {
                      try {
                        await persistence.linkNewWorkspaceFile(state);
                        const refreshed = persistence.loadStateFromLocalStorage();
                        if (refreshed) persist(refreshed);
                        setLinkedWorkspaceFileName(persistence.getLinkedWorkspaceFileName());
                        setMessage({ type: "ok", text: uiText(ui, "msgLinkedWorkspaceNew") });
                      } catch (e) {
                        if (isUserAbortError(e)) return;
                        setMessage({
                          type: "error",
                          text: formatUi(ui, "errWorkspaceFilePick", {
                            detail: e instanceof Error ? e.message : String(e),
                          }),
                        });
                      }
                    })()
                  }
                >
                  {uiText(ui, "dataWorkspaceLinkNew")}
                </button>
                {linkedWorkspaceFileName ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void (async () => {
                        try {
                          await persistence.unlinkWorkspaceFile();
                          setLinkedWorkspaceFileName(null);
                          setMessage({ type: "ok", text: uiText(ui, "msgUnlinkedWorkspace") });
                        } catch (e) {
                          if (isUserAbortError(e)) return;
                          setMessage({
                            type: "error",
                            text: formatUi(ui, "errWorkspaceFilePick", {
                              detail: e instanceof Error ? e.message : String(e),
                            }),
                          });
                        }
                      })()
                    }
                  >
                    {uiText(ui, "dataWorkspaceUnlink")}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          <div className="row" style={{ marginTop: "1rem" }}>
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

          <h3 style={{ marginTop: "1.5rem" }}>{uiText(ui, "categoriesSectionTitle")}</h3>
          <p className="subtle">{uiText(ui, "categoriesSectionHelp")}</p>
          <div className="table-wrap" style={{ maxHeight: 220 }}>
            <table>
              <thead>
                <tr>
                  <th>{uiText(ui, "thCategoryName")}</th>
                  <th>{uiText(ui, "thCategoryColor")}</th>
                  <th className="subtle">{uiText(ui, "thCategoryId")}</th>
                </tr>
              </thead>
              <tbody>
                {state.categories.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>
                      <span className="swatch" style={{ background: c.color }} title={c.color} />
                      <code>{c.color}</code>
                    </td>
                    <td className="subtle">
                      <code>{c.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row drop" style={{ marginTop: "0.75rem" }}>
            <label className="profile-field" style={{ flex: "1 1 200px" }}>
              <span>{uiText(ui, "addCategoryName")}</span>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={uiText(ui, "addCategoryNamePlaceholder")}
              />
            </label>
            <label className="profile-field" style={{ flex: "0 0 auto" }}>
              <span>{uiText(ui, "addCategoryColor")}</span>
              <input
                type="color"
                value={newCategoryColor}
                onChange={(e) => setNewCategoryColor(e.target.value)}
                aria-label={uiText(ui, "addCategoryColor")}
                style={{ width: "3rem", height: "2.25rem", padding: 0, border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "transparent" }}
              />
            </label>
            <button type="button" className="btn btn-primary" onClick={addUserCategory}>
              {uiText(ui, "addCategoryButton")}
            </button>
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

      <ProfileMenu
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        ui={ui}
        settings={userSettings}
        onSettingsChange={setUserSettings}
        onDownloadDemoCredit={() => downloadDemo("samples/fake-credit-card.csv", "fake-credit-card.csv")}
        onDownloadDemoBudget={() => downloadDemo("samples/fake-budget.csv", "fake-budget.csv")}
      />
    </>
  );
}
