import type { AppManifest } from "./runtime/manifest";
import type { AppState, Category, MerchantRule } from "./types";
import { createEmptyState } from "./types";

export type Persistence = {
  loadStateFromLocalStorage: () => AppState | null;
  saveStateToLocalStorage: (state: AppState) => void;
  downloadStateJson: (state: AppState, filename?: string) => void;
  parseStateJsonFile: (file: File) => Promise<AppState>;
};

export function createPersistence(
  manifest: AppManifest,
  seedCategories: Category[],
  seedMerchantRules: MerchantRule[],
): Persistence {
  const key = manifest.localStorageKey;
  const version = manifest.stateVersion;

  function normalizeLoadedState(parsed: AppState): AppState {
    const base = createEmptyState(version, seedCategories, seedMerchantRules);
    return {
      ...base,
      ...parsed,
      version,
      categories: Array.isArray(parsed.categories) ? parsed.categories : base.categories,
      merchantRules: Array.isArray(parsed.merchantRules)
        ? parsed.merchantRules
        : base.merchantRules,
      purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
    };
  }

  return {
    loadStateFromLocalStorage(): AppState | null {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as AppState;
        if (parsed && typeof parsed.version === "number" && parsed.version === version) {
          return normalizeLoadedState(parsed);
        }
      } catch {
        /* ignore */
      }
      return null;
    },

    saveStateToLocalStorage(state: AppState): void {
      const next: AppState = { ...state, updatedAt: new Date().toISOString(), version };
      localStorage.setItem(key, JSON.stringify(next, null, 2));
    },

    downloadStateJson(state: AppState, filename = "spend-tracker-state.json"): void {
      const next: AppState = { ...state, updatedAt: new Date().toISOString(), version };
      const blob = new Blob([JSON.stringify(next, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },

    async parseStateJsonFile(file: File): Promise<AppState> {
      const text = await file.text();
      const parsed = JSON.parse(text) as AppState;
      if (!parsed || typeof parsed.version !== "number" || parsed.version !== version) {
        throw new Error(`Invalid state file: expected version ${version}`);
      }
      return normalizeLoadedState(parsed);
    },
  };
}
