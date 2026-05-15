import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { loadAppBootstrap } from "./runtime/manifest";
import { createPersistence } from "./storage";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

rootEl.innerHTML =
  '<div class="panel"><p class="subtle">Loading configuration…</p></div>';

loadAppBootstrap()
  .then((bootstrap) => {
    const persistence = createPersistence(
      bootstrap.manifest,
      bootstrap.initialCategories,
      bootstrap.initialMerchantRules,
    );
    rootEl.innerHTML = "";
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App bootstrap={bootstrap} persistence={persistence} />
      </React.StrictMode>,
    );
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    rootEl.innerHTML = "";
    rootEl.textContent = `Failed to start: ${msg}`;
  });
