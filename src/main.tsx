import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { loadAppBootstrap } from "./runtime/manifest";
import { createPersistence } from "./storage";
import type { AppState } from "./types";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

rootEl.innerHTML =
  '<div class="panel"><p class="subtle">Loading configuration…</p></div>';

loadAppBootstrap()
  .then(async (bootstrap) => {
    const persistence = createPersistence(
      bootstrap.manifest,
      bootstrap.initialCategories,
      bootstrap.initialMerchantRules,
    );
    await persistence.hydrateLinkedWorkspaceFile();

    let initialAppState: AppState | undefined;
    if (persistence.getLinkedWorkspaceFileName()) {
      const fromFile = await persistence.loadStateFromLinkedWorkspace();
      if (fromFile) initialAppState = fromFile;
    }

    rootEl.innerHTML = "";
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App
          bootstrap={bootstrap}
          persistence={persistence}
          initialAppState={initialAppState}
        />
      </React.StrictMode>,
    );
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    rootEl.innerHTML = "";
    rootEl.textContent = `Failed to start: ${msg}`;
  });
