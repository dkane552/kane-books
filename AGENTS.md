## Kane Books

Personal books for Derek Kane, a QuickBooks-style app for personal finances. Built from the accounting side
of Spyglass Projects (github.com/dkane552/spyglass-builder-hub) with the builder parts left out: no jobs,
cost codes, bills, invoices, A/R, A/P, work in progress, 1099s or QuickBooks sync. One login, its own
Supabase project (`moszaslmoudygmxygzcf`, "Kane Books") and its own site. Nothing is shared with Spyglass.

## Application architecture
- TanStack Start (static single-page build) + TanStack Query over Supabase. Pages live in
  `src/components/app`, routes in `src/routes` (thin; search params checked with `src/lib/search.ts`).
- Data goes through `src/lib/data.ts`. Every query key starts with `"db"`; every write through `useDb()`
  refreshes them all. Live updates (`useLiveRefresh`) refresh on Realtime changes, so a bank sync shows up.
- Money math lives in SQL functions; the UI lays them out and never recomputes the books.
- Access: `app_users` (Derek only) and `is_team()` on every table (`(select public.is_team())` so it runs
  once per query). A confirmed email is required, and once an authenticator app is set up (Settings >
  Security) only a session that entered its code gets in. Logged-out visitors get nothing but `keepalive()`.
- UI copy: no em dashes. Colors come from the tokens in `styles.css` (navy brand, brass accent); charts use
  `--chart-income`, `--chart-spending`, `--chart-net`. Font sizes scale with `--ts` (Settings > Accessibility).

## The books (`supabase/2_ledger.sql`)
- Double entry. `gl_accounts.account_type`: what you own (Bank, Investment, Retirement, Property, Vehicle,
  Other Asset), what you owe (Credit Card, Loan, Mortgage, Other Liability), Equity, and categories (Income,
  Expense, Other Income, Other Expense). Personal categories only (no business ones), grouped like Era's own
  (`category_group`: Housing, Daily living, Transportation, Lifestyle, Financial, Taxes, Other) for budgets and
  reports. `era_category` names the Era category a category matches (Era tags every bank transaction). `tax_line`
  puts a category on the tax summary; `ledger_lines.tax_line` overrides one line.
- Every transaction is a `ledger_entries` row (expense, deposit, transfer, journal, valuation, opening) with
  `ledger_lines` (debit or credit, optional `project_id`). Save with
  `rpc("save_ledger_entry", { p_entry, p_lines })`; debits must equal credits (checked at commit).
- `v_gl` is the general ledger (amount = debit less credit). Reports: `report_profit_and_loss`,
  `report_pl_by_month`, `report_pl_by_project`, `report_project_detail`, `account_balances`,
  `report_balance_sheet` (sections What you own / What you owe / Net worth), `report_trial_balance`,
  `report_general_ledger`, `report_by_payee`, `report_payee_activity`, `report_tax_summary`,
  `report_tax_detail`, `report_net_worth_series`.
- Valuations: `post_valuation(account, date, value)` moves an investment, retirement account, house or car to
  what it is worth, one entry per account per day (`external_ref` `value:<account>:<date>`), against
  `book_settings.value_change_gl_id` ("Investment and asset value changes", Other Income). That keeps net worth
  true without tracking every trade.
- Locks: `book_settings.books_closed_through` locks the period; completed reconciliations lock their entries.
  The SQL editor (postgres) is not blocked. `audit_log` records every change and cannot be edited.
- Payees are names (`payees`); `payee_for(name)` finds or adds one, so the UI takes typed names.

## Bank feed (`supabase/3_bank_feed.sql`, Edge Function `supabase/functions/era`)
- Same design as Spyglass's feed. `era` (JWT verification off; it checks `is_team` with the caller's token;
  secret `ERA_API_KEY`) reads only linked `bank_feed_accounts`, so the Spyglass business accounts in the same
  Era login are never stored. CSV statements go in through `bank_import_statement`; Era and uploads never
  double up.
- `bank_autoprocess()` matches each new transaction to one entry on that account with the same amount within
  5 days (a transfer entered from one side matches the other side), else applies the first `bank_rules` match
  (suggestion, or added when `auto_add`), else suggests from Era (`source` 'era transfer': the linked account
  when Era paired it with a transaction on another linked account; 'era': the category whose `era_category`
  matches, income categories only for money in). `bank_accept` makes one entry (split lines, category,
  project); lines to a balance-sheet account make it a transfer. `bank_accept_many` adds a list in one call
  (Add all categorized; a transfer whose other side is already in matches instead). `bank_match`,
  `bank_exclude`, `bank_undo`. A sync takes each Era id once per read and keeps going past a failed account.
- Investment and retirement accounts link `balance_only` with `auto_value`: the sync posts a valuation from
  Era's balance (`feed_auto_valuations`).
- Transactions > Bank feed has a category picker and Add on every row, Add all categorized, and More for
  splits, matches and rules. Accounts and rules links Era accounts (making a books account for each).

## Budgets, recurring, home (`supabase/4_personal.sql`)
- `budget_amounts`: month null = the usual amount every month; a month row overrides one month.
  `report_budget(month)` and `report_budget_year(year)`.
- `recurring_bills` (+ `v_recurring_bills`): matched to bank transactions by `match_text` against the raw
  description or `merchant_key()`. Next date from the last one seen plus the cadence; late after 5 days.
  `recurring_candidates()` finds repeating charges (3+ times, steady gap, amounts within half), leaving out
  transfers and anything in `recurring_dismissed`.
- `home_summary(today)` returns the whole home screen as JSON: balances, totals, this month, budget, spending by
  group, 12 months of income/spending and net worth (from the books start date), upcoming bills and the Needs
  attention list (each item has a link).

## Projects
- `projects` (business or personal). Business projects get a Schedule C page in the tax pack.

## Tax pack
- `src/lib/tax-pack.ts` with the dependency-free writer `src/lib/xlsx.ts`: Summary (checks), Tax Lines, Tax
  Detail, Businesses, Income and Spending, Net Worth (start and end of year), General Ledger, Reconciliations.

## Database files and tests
- Run `supabase/1_base.sql` to `5_security.sql` in order (all safe to re-run), or `supabase/setup_all.sql`
  (built by `scripts/build-setup-sql.sh`) in one paste. Re-run `5_security.sql` after adding a table.
- Tests on a scratch Postgres, never production: load `supabase/tests/supabase_stub.sql`, files 1 to 5, then
  `psql -f supabase/tests/books_test.sql` (rolls back). `supabase/tests/demo_seed.sql` loads made-up data for
  looking at the app. Unit tests: `npm test`.
- Schema changes: edit the numbered file, rebuild `setup_all.sql`, run it in the SQL editor, update
  `src/lib/types.ts`.

## Hosting (free plans)
- Supabase project `moszaslmoudygmxygzcf`. The URL and publishable key are defaults in `src/lib/supabase.ts`
  (public by design; RLS protects the data). Never commit a secret or service-role key.
- Cloudflare Pages serves the `deploy` branch as static files. Ship with `scripts/deploy.sh` (builds and
  pushes `deploy`).
- `.github/workflows/keepalive.yml` calls `keepalive()` every 3 days so the free project never pauses.
- Backups: Edge Function `backup` (header `x-backup-token` = secret `BACKUP_TOKEN`) and
  `scripts/backup-to-drive.gs` (nightly, Google Drive). Restore with `scripts/restore_backup.py`.
