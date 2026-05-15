# Spend & Budget Tracker

A static, client-side web application for ingesting credit card and bank exports (CSV or Excel), automatically categorizing purchases using built-in rules, manually refining categories, importing a separate budget worksheet, and visualizing **spending versus budget** on a simple dashboard.

There is **no backend** in this version: data lives in the browser (`localStorage`) and can be round-tripped as a single JSON document that mirrors a future relational schema (categories, rules, purchases with `categoryId`, budget lines).

## Features

- **Transaction import**: CSV or `.xlsx` / `.xls` with heuristic column detection (date, description, amount, optional type and issuer category).
- **Auto-categorization**: Default categories and merchant rules load from URLs in [`public/config/runtime.json`](public/config/runtime.json) (see `defaults.*Url`), plus mapping from issuer category text when it matches a category name.
- **Editable categories**: Change any row’s category from a dropdown; state persists immediately in the browser and in exported JSON.
- **Budget import**: Second upload path for a budget grid (category + amount columns). Each import **replaces** the in-memory budget snapshot so you can revise numbers as income changes.
- **Dashboard**: Per-category spend totals overlaid with budget totals, percent of budget used, and remaining dollars.
- **JSON export/import**: Download `spend-tracker-state.json` for backups or a future API/database.

| File | Description |
| --- | --- |
| [`public/samples/chase-like-sample.csv`](public/samples/chase-like-sample.csv) | Example transaction export. |
| [`public/samples/budget-sample.csv`](public/samples/budget-sample.csv) | Example budget worksheet. |

## Prerequisites

- **Node.js 20+** and npm (for local development and production builds).

## Quick start (local)

```bash
git clone <your-repo-url>
cd spend-budget-app
npm ci
npm run dev
```

Open the URL printed in the terminal (typically `http://localhost:5173`).

### Production build & preview

```bash
npm ci
npm run build   # output in dist/
npm run preview # serves dist/ locally
```

## GitHub Pages (test hosting)

1. Push this repository to GitHub (this folder as the repo root).
2. In the repository **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).  
   **Why:** “Deploy from a branch” with **/ (root)** only serves files from the **repository root** on that branch. This project has no `index.html` there (the Vite entry lives in [`root/index.html`](root/index.html), which is a *folder named `root`*—not the same as GitHub’s “(root)” option). The live site is produced by the workflow into **`dist/`**, which Actions deploys.
3. The workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds on every push to `main` or `master` and publishes the `dist/` folder to GitHub Pages.
4. After the first successful run, open the **Pages** environment URL shown in the workflow summary. If the site was previously set to branch publishing, switch the source to **GitHub Actions** and wait for a new **“pages build and deployment”** run to finish.

The Pages workflow sets `VITE_BASE` to `/{repository-name}/` so scripts and styles load on project sites like `https://USERNAME.github.io/REPO-NAME/` even without a trailing slash. Local builds omit it and use `base: "./"`.

## CI and AWS-style static deploy

- **Continuous integration**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm ci` and `npm run build` on pushes and pull requests. It uploads **`dist`** as the production bundle and **`flores-finance-local-static`** as a zip (built `dist/` plus `README-LOCAL.txt`) so you can download a runnable build from the Actions run without cloning.
- **Amazon S3 + CloudFront (static website)**:
  1. Create an S3 bucket configured for static website hosting **or** a private bucket fronted by CloudFront with `index.html` as the default root object.
  2. Sync the build output:

     ```bash
     npm ci
     npm run build
     aws s3 sync dist/ s3://YOUR_BUCKET_NAME --delete
     ```

  3. Invalidate the CloudFront cache if applicable:

     ```bash
     aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
     ```

Because the app is fully static, you can host it on any object store or CDN; no server runtime is required.

## Runtime configuration (nothing baked into TypeScript)

On startup the app fetches a **manifest** JSON and all default data from the network (same origin by default):

| File | Purpose |
| --- | --- |
| [`public/config/runtime.json`](public/config/runtime.json) | `localStorageKey`, `stateVersion`, `fallbackCategoryId`, `defaults` (URLs to category/rule files), `importPatterns` (CSV/XLSX heuristics), and `ui` (all user-visible copy). |
| [`public/config/default-categories.json`](public/config/default-categories.json) | Default category list (replace or point `defaults.categoriesUrl` elsewhere). |
| [`public/config/default-merchant-rules.json`](public/config/default-merchant-rules.json) | Default substring → category rules. |

Override the manifest location with **`VITE_RUNTIME_MANIFEST_URL`** (see [`.env.example`](.env.example)) to load config from a CDN or another static host.

Changing **`stateVersion`** intentionally invalidates older `localStorage` snapshots so you can migrate schemas without silently mixing incompatible data.

## Project layout

| Path | Purpose |
| --- | --- |
| `public/config/runtime.json` | Manifest: storage key, schema version, default asset URLs, import heuristics, UI strings. |
| `public/config/default-categories.json` | Default categories (served as a static asset). |
| `public/config/default-merchant-rules.json` | Default merchant rules (served as a static asset). |
| `src/runtime/manifest.ts` | Fetches and validates the manifest; loads default JSON. |
| `src/categorize.ts` | Categorization, column inference, and row → `Purchase` mapping (driven by `importPatterns`). |
| `src/parseFile.ts` | CSV / Excel ingestion via `papaparse` and lazy-loaded `xlsx`. |
| `src/storage.ts` | `createPersistence()` binds `localStorage` + JSON import/export to manifest keys and version. |
| `src/App.tsx` | UI: tabs for dashboard, transactions, budget, and data tools. |
| `PROMPTS.md` | Archived prompts used to create the app. |
| `HOW_IT_WAS_MADE.md` | Design notes and rationale. |

## JSON schema (`AppState`)

The downloadable / importable document matches `AppState` in `src/types.ts`:

- `version`: must match `stateVersion` in your active `runtime.json` manifest (default `1`).
- `updatedAt`: ISO timestamp string.
- `categories`: array of `{ id, name, color }`.
- `merchantRules`: array of `{ match, categoryId }` (case-insensitive substring match on descriptions).
- `purchases`: array of `{ id, date, description, amount, spendAmount, categoryId, sourceFileName, rawRow }`.
- `budgets`: array of `{ id, categoryId, label, amount, sourceFileName }`.

`spendAmount` is the non-negative dollar amount attributed to spending for dashboard totals (payments and obvious credits use `0`).

## Security & privacy notes

- Files are parsed **in your browser**; nothing is uploaded to a server in this build.
- Treat issuer exports as **sensitive**; protect downloaded JSON the same way you would protect the original CSV/XLSX.
- The `xlsx` dependency is convenient but historically has had security advisories; only open spreadsheets from sources you trust, and keep dependencies updated (`npm audit`).

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload. |
| `npm run build` | Typecheck (`tsc --noEmit`) and production bundle to `dist/`. |
| `npm run preview` | Local static preview of `dist/`. |
| `npm run lint` | Typecheck only. |

## Troubleshooting

- **Wrong amounts or missing rows**: Many issuers use different sign conventions. The importer samples the first rows to guess whether **negative amounts mean spend**; you can still adjust categories manually.
- **Budget not showing**: Ensure the spreadsheet has recognizable headers (for example a column containing “Category” and another containing “Budget” or “Amount”).
- **Blank screen on GitHub Pages**: Confirm **Settings → Pages** uses **GitHub Actions** as the source and that the `pages` workflow completed successfully.

## License

This template project is provided as-is for personal finance experimentation. Verify categorization and totals against your official issuer statements before making financial decisions.
