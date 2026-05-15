# How this application was built (and why)

This document explains the technical choices behind **Spend & Budget Tracker** so future contributors can extend it toward a hosted API and database without surprises.

## Goals from the product brief

1. Ingest **realistic credit card / bank exports** (CSV and Excel) with messy headers and mixed conventions.
2. **Automatically categorize** merchants where possible, with a clear path to human correction.
3. Persist a **single JSON aggregate** that can later map cleanly to SQL tables (`categories`, `merchant_rules`, `purchases`, `budget_lines`).
4. Import a **separate budget worksheet** and show **actual versus budget** on a dashboard.
5. Ship as a **static site** suitable for **GitHub Pages** and **AWS S3/CloudFront**, with **GitHub Actions** CI.

## Why a static React app

Personal finance data is sensitive. A static build keeps the default deployment story **client-only**: exports never leave the machine unless the user chooses to host a backend later.

React plus TypeScript gives a straightforward component model for tabbed workflows (dashboard, editable grid, data utilities) while staying small enough for a single contributor to maintain.

## Parsing strategy

### Credit card CSV shapes

Issuers rarely agree on column names, but most exports include some combination of:

- transaction date and/or posting date,
- merchant / description text,
- signed amount,
- optional transaction type (`Sale`, `Payment`, `Credit`),
- optional coarse category assigned by the bank.

The parser (`src/parseFile.ts` + `src/categorize.ts`) therefore:

1. Normalizes headers and scores them against **dictionaries supplied in the runtime manifest** (`importPatterns` in `public/config/runtime.json`), not literals in code.
2. Infers whether **negative amounts imply spend** by sampling the first rows (Chase-style vs other conventions), using the configured sample size and fallback amount headers.
3. Uses an explicit **type** column when present to zero out payments/credits for spend totals, using configurable substring lists.

### Excel support

`papaparse` handles CSV. For Excel, the `xlsx` package reads workbooks in the browser. The dependency is **lazy-loaded** only when a non-CSV file is chosen, keeping the initial JavaScript bundle smaller for GitHub Pages.

### Budget spreadsheets

Budget files are even less standardized. The importer scores headers using **`importPatterns.budget`** from the manifest (weights, regexes, minimum scores), then maps free-text labels into app categories using the same merchant / label rules used for transactions.

Each budget upload **replaces** the prior in-memory budget list so users can revise their plan holistically when income or goals change.

## Runtime manifest instead of bundled defaults

Categories, merchant rules, UI copy, `localStorage` key, schema version, fallback category id, and CSV/XLSX heuristics are loaded at startup from JSON (`public/config/runtime.json` by default, or `VITE_RUNTIME_MANIFEST_URL`). That keeps product text and tuning out of the compiled bundle so teams can iterate on config without redeploying TypeScript for every copy change—while still shipping a static artifact.

## Categorization pipeline

1. If the issuer provides a category string that matches (or loosely contains) an app category name, that wins.
2. Otherwise, lowercase **substring rules** from the configured merchant-rules JSON are evaluated in file order.
3. If nothing matches, purchases use the configured **`fallbackCategoryId`** (default `other` in the sample manifest).

Users can override any purchase in the UI; overrides are stored alongside the row in the aggregate JSON.

## Persistence model

Browsers cannot silently write to the user’s filesystem. To honor the “JSON file” requirement in a static deployment:

- The canonical runtime store is **`localStorage`**, updated on every mutation.
- Users can **download** the same JSON structure at any time (and **upload** to restore or move machines).

This matches how many static finance tools work today while preserving a schema that maps to future `INSERT` statements.

## Continuous integration and hosting

- **`ci.yml`** runs `npm ci` and `npm run build` for reproducible artifacts; the `dist/` folder is uploaded as a workflow artifact for download or chained deploy actions.
- **`pages.yml`** uses the official **GitHub Pages** actions (`upload-pages-artifact` + `deploy-pages`) so test deployments do not depend on personal access tokens.

## Known limitations (intentional for v1)

- No multi-user auth, no server-side validation, and no automatic bank aggregation APIs.
- Duplicate detection across repeated imports is not attempted; users should avoid uploading the same statement twice or clear purchases first.
- Category discovery from completely novel merchants still requires new rules or manual edits.

## Suggested next steps toward a database-backed service

1. Stand up a minimal REST or GraphQL API that accepts the same JSON schema (or normalized tables).
2. Move merchant rules into an admin table and cache compiled matchers server-side.
3. Add idempotent import jobs keyed by `(account_id, statement_period)` to prevent duplicates.
4. Optionally replace `xlsx` server-side with a hardened parser and virus scanning pipeline.

This roadmap keeps the current static app useful as a **prototype UI** and **schema reference** while the backend evolves.
