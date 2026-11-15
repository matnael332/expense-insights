# Expense Insights Dashboard: specification (v1.1, 2026-11-15; stage 1 built)

Extension of the existing CLI. Adds a browser dashboard where a user uploads credit-card statements from several cards and gets an interactive visual overview of their spending.

## Goal
Show a complete, privacy-respecting fintech tool in the portfolio: parse messy real-world statements, merge cards, and present clear visuals.

## Principles
- **Everything runs in the browser.** No server, no upload, no network calls. A strict Content-Security-Policy in `index.html` blocks network access, so this is verifiable.
- **No transaction data is stored.** Data lives in memory until the tab closes. Only the user's category overrides may be saved (see Open decisions).
- **File content is untrusted data.** Merchant names and every other cell are escaped on render; never inserted as HTML.
- **Honest scope.** Israeli issuer layouts are built from general knowledge and synthetic samples, not real statements. The README must say "not verified on real statements".

## Stages
**Stage 1 (this build)**
1. Generic CSV with a column-mapping step (user picks date, description, amount, optional card/installment columns).
2. Excel (.xlsx) exports of Israeli card companies (Isracard, Max, Cal): header row auto-detected by Hebrew column names; falls back to the same mapping UI when detection fails.
3. Multi-file upload, one file per card. Card label from a user-editable name (default: file name).
4. Dashboard (below).
5. Synthetic sample files and a "load demo data" button.

**Stage 2 (separate approval)**: PDF statements via PDF.js text extraction, only after testing on a real (even blurred) statement.

**Out of scope**: bank-account statements, accounts/login, any backend, mobile app, OCR of scanned PDFs, advice or budgeting recommendations.

## Input handling
- Amounts: expenses are positive in card statements and normalized to the internal rule (negative = expense); the sign convention is auto-detected per file or chosen in the mapping dialog. Totals count expenses only; refunds and income are shown as a separate note and are not netted against spending. Currency: ILS only in v1; foreign-currency rows are shown but flagged and excluded from totals unless an ILS charge amount exists.
- Installments (תשלומים): keep each charge as listed (the amount actually billed that month); show "payment 3/12" info in the table when present. Do not project future payments in v1.
- Dates: ISO, and DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY (2-digit years allowed). Slash dates are always read as day first (Israeli convention), documented in the README; impossible dates (month above 12, 31/02) are rejected, never guessed.
- Validation: same principle as the CLI: bad rows are reported with file name and row number, nothing is silently dropped.
- Duplicate protection: exact duplicate rows across different files are kept (two cards can legitimately match) but re-uploading the same file name is blocked.

## Dashboard
Filters: month range, card (multi-select).
1. **Monthly trend**: stacked bar of spending per month, split by card; line for income if present.
2. **Spending by category**: ranked horizontal bars (one hue, value at the bar end) plus a table view with totals and share. Changed from a donut: ranked bars compare parts more exactly and scale past 6 parts.
3. **Top merchants**: top 10 by total amount and by number of transactions.
4. **Unusual and recurring**:
   - Unusual: expense larger than 3x the median of its category (min 4 expenses), same rule as the CLI.
   - Recurring: same normalized merchant in at least 3 distinct months with amounts within 10% of their median. Shown with monthly cost and yearly total.
- Summary cards: total spent, monthly average, number of transactions, biggest single expense.
- A transactions table with search, to explain every number on the charts.

## Categories
- Built-in keyword rules in Hebrew and English (examples: שופרסל, רמי לוי, סופר, קפה, דלק, פז, סונול, חשמל, נטפליקס, פארם).
- The user can change the category of any merchant in the UI; the choice applies to all its transactions. Merchant names are normalized (trim, lowercase, strip branch numbers and punctuation) before matching.
- The existing Python CLI keeps its own English rules; they are not shared in v1 (explicit owner decision 2026-11-15).

## Architecture
- Folder `web/`: `index.html` plus classic (non-module) script files, so it opens by double-click from disk without a server or build step.
- `web/vendor/`: vendored libraries with their license files. Built with: Chart.js 4.6.1 (charts) and read-excel-file 9.3.17 (xlsx; the SheetJS build on npm is old with known file-parsing vulnerabilities and its CDN is not reachable here). PDF.js in stage 2. Versions pinned and recorded in `web/vendor/README.md`.
- Parsing and analysis logic in pure functions (no DOM) so it can be tested on its own.
- UI language: Hebrew, right-to-left. Code, comments and README in English.

## Testing
- Parsing, normalization, category rules, anomaly and recurring detection: automated tests with Node's built-in test runner (`node --test "web/tests/*.test.js"`), including parsing the generated .xlsx samples through the vendored reader. Existing 9 Python tests must keep passing.
- Manual check in a real browser of the demo data and each sample file; reported honestly, including anything not verified.

## Acceptance criteria (stage 1)
1. Opening `web/index.html` from disk and loading the demo shows all four dashboard sections with no console errors.
2. Uploading three synthetic files (two Excel-style, one CSV) merges into one dataset with a correct per-card split.
3. A file with bad rows reports the exact file and row; the rest is not silently lost.
4. Network access is blocked by CSP and no request leaves the page (checked in the browser's network panel).
5. Changing a merchant's category updates every chart.
6. Tests pass; README documents run steps, privacy model and "not verified on real statements".

## Status
Stage 1 built and verified in headless Chromium from `file://` (demo data, real .xlsx/.csv upload, mapping dialog, filters, category override, export/import, CSP network block, light and dark). Not verified: real statements, Firefox, Safari. Stage 2 (PDF) not started.

## Decisions taken (defaults used)
- Keep category overrides across visits: **save only the overrides in localStorage** (never transactions), with export/import as a JSON file / memory only / no saving.
- Hebrew UI: **yes**.
- Effort: this exceeds the "about 2 hours" rule by owner decision; delivered in checkpoints, each one runnable and committed-ready.
- Pushing the existing CLI to GitHub is still awaiting approval and is independent of this extension.
