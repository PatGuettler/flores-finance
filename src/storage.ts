import type { AppManifest } from "./runtime/manifest";
import type { AppState, Category, MerchantRule } from "./types";
import { createEmptyState } from "./types";
import {
  idbClearWorkspaceFileHandle,
  idbGetWorkspaceFileHandle,
  idbSetWorkspaceFileHandle,
  isWorkspaceFileApiAvailable,
  workspaceFileReadText,
  workspaceFileRequestReadWrite,
  workspaceFileWriteText,
} from "./workspaceFile";

export type Persistence = {
  loadStateFromLocalStorage: () => AppState | null;
  saveStateToLocalStorage: (state: AppState) => void;
  downloadStateJson: (state: AppState, filename?: string) => void;
  parseStateJsonFile: (file: File) => Promise<AppState>;
  /** True when the browser can link a JSON file and auto-save (Chromium, secure context). */
  isWorkspaceFilePersistenceAvailable: () => boolean;
  /** Load handle from IndexedDB (call before first render). */
  hydrateLinkedWorkspaceFile: () => Promise<void>;
  /** Display name of the linked file, if any. */
  getLinkedWorkspaceFileName: () => string | null;
  /** Read current state from the linked file (after hydrate). */
  loadStateFromLinkedWorkspace: () => Promise<AppState | null>;
  /** Pick an existing JSON file; becomes primary storage with localStorage mirror. */
  linkExistingWorkspaceFile: () => Promise<AppState>;
  /** Pick where to save; writes current state and links for future auto-saves. */
  linkNewWorkspaceFile: (currentState: AppState) => Promise<void>;
  /** Stop writing to disk file; keeps localStorage as-is. */
  unlinkWorkspaceFile: () => Promise<void>;
};

export function createPersistence(
  manifest: AppManifest,
  seedCategories: Category[],
  seedMerchantRules: MerchantRule[],
): Persistence {
  const key = manifest.localStorageKey;
  const version = manifest.stateVersion;
  let workspaceFileHandle: FileSystemFileHandle | null = null;

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

  function parseStateJsonText(text: string): AppState {
    const parsed = JSON.parse(text) as AppState;
    if (!parsed || typeof parsed.version !== "number" || parsed.version !== version) {
      throw new Error(`Invalid state file: expected version ${version}`);
    }
    return normalizeLoadedState(parsed);
  }

  function loadStateFromLocalStorageImpl(): AppState | null {
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
  }

  function saveStateToLocalStorageImpl(state: AppState): void {
    const next: AppState = { ...state, updatedAt: new Date().toISOString(), version };
    const json = JSON.stringify(next, null, 2);
    localStorage.setItem(key, json);
    const handle = workspaceFileHandle;
    if (handle) {
      void (async () => {
        try {
          await workspaceFileRequestReadWrite(handle);
          await workspaceFileWriteText(handle, json);
        } catch {
          /* permission or disk issue — localStorage still holds latest */
        }
      })();
    }
  }

  return {
    isWorkspaceFilePersistenceAvailable(): boolean {
      return isWorkspaceFileApiAvailable();
    },

    async hydrateLinkedWorkspaceFile(): Promise<void> {
      workspaceFileHandle = await idbGetWorkspaceFileHandle();
    },

    getLinkedWorkspaceFileName(): string | null {
      return workspaceFileHandle?.name ?? null;
    },

    async loadStateFromLinkedWorkspace(): Promise<AppState | null> {
      if (!workspaceFileHandle) return null;
      try {
        await workspaceFileRequestReadWrite(workspaceFileHandle);
        const text = await workspaceFileReadText(workspaceFileHandle);
        return parseStateJsonText(text);
      } catch {
        return null;
      }
    },

    async linkExistingWorkspaceFile(): Promise<AppState> {
      const pickOpen = window.showOpenFilePicker;
      if (!pickOpen) throw new Error("File picker API is not available.");
      const [handle] = await pickOpen({
        multiple: false,
        types: [
          {
            description: "JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      await workspaceFileRequestReadWrite(handle);
      const text = await workspaceFileReadText(handle);
      const parsed = parseStateJsonText(text);
      workspaceFileHandle = handle;
      await idbSetWorkspaceFileHandle(handle);
      saveStateToLocalStorageImpl(parsed);
      return loadStateFromLocalStorageImpl() ?? parsed;
    },

    async linkNewWorkspaceFile(currentState: AppState): Promise<void> {
      const pickSave = window.showSaveFilePicker;
      if (!pickSave) throw new Error("File picker API is not available.");
      const handle = await pickSave({
        suggestedName: "spend-tracker-state.json",
        types: [
          {
            description: "JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      await workspaceFileRequestReadWrite(handle);
      workspaceFileHandle = handle;
      await idbSetWorkspaceFileHandle(handle);
      saveStateToLocalStorageImpl(currentState);
    },

    async unlinkWorkspaceFile(): Promise<void> {
      workspaceFileHandle = null;
      await idbClearWorkspaceFileHandle();
    },

    loadStateFromLocalStorage(): AppState | null {
      return loadStateFromLocalStorageImpl();
    },

    saveStateToLocalStorage(state: AppState): void {
      saveStateToLocalStorageImpl(state);
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
      return parseStateJsonText(text);
    },
  };
}
