// Row shapes for Kane Books, matching the tables, views and report functions in supabase/1_base.sql to
// 5_security.sql. Postgres numerics arrive as numbers or strings; read them through num() in format.ts.
export type Num = number | string | null;

export interface AppUser {
  email: string;
  full_name: string;
  initials: string | null;
  created_at: string;
}

export interface BookSettings {
  id: number;
  owner_name: string;
  ledger_start_date: string | null;
  books_closed_through: string | null;
  bank_feed_start_date: string | null;
  fiscal_year_start_month: number;
  default_cash_gl_id: string | null;
  net_worth_carried_gl_id: string | null;
  opening_equity_gl_id: string | null;
  value_change_gl_id: string | null;
  uncategorized_expense_gl_id: string | null;
  uncategorized_income_gl_id: string | null;
  updated_at: string;
}

export interface Payee {
  id: string;
  name: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  is_business: boolean;
  color: string | null;
  is_active: boolean;
  started_on: string | null;
  created_at: string;
}

export type GlAccountType =
  | "Bank"
  | "Investment"
  | "Retirement"
  | "Property"
  | "Vehicle"
  | "Other Asset"
  | "Credit Card"
  | "Loan"
  | "Mortgage"
  | "Other Liability"
  | "Equity"
  | "Income"
  | "Expense"
  | "Other Income"
  | "Other Expense";

export type Classification = "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";

export interface GlAccount {
  id: string;
  number: string | null;
  name: string;
  account_type: GlAccountType;
  classification: Classification;
  is_valued: boolean;
  category_group: string | null;
  tax_line: string | null;
  description: string | null;
  institution: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type LedgerEntryType =
  "expense" | "deposit" | "transfer" | "journal" | "valuation" | "opening";

export interface LedgerLine {
  id: string;
  entry_id: string;
  position: number;
  gl_account_id: string;
  debit: Num;
  credit: Num;
  description: string | null;
  project_id: string | null;
  tax_line: string | null;
}

export interface LedgerEntry {
  id: string;
  entry_type: LedgerEntryType;
  entry_date: string;
  number: string | null;
  payee_id: string | null;
  memo: string | null;
  total: Num;
  is_void: boolean;
  external_ref: string | null;
  created_by: string | null;
  created_at: string;
  ledger_lines?: LedgerLine[];
}

export interface GlRow {
  source: string;
  source_id: string;
  doc_number: string | null;
  txn_date: string;
  entry_type: LedgerEntryType;
  line_id: string;
  gl_account_id: string;
  account_name: string;
  account_number: string | null;
  account_type: GlAccountType;
  classification: Classification;
  category_group: string | null;
  tax_line: string | null;
  amount: Num;
  debit: Num;
  credit: Num;
  project_id: string | null;
  project_name: string | null;
  party_id: string | null;
  party_name: string | null;
  memo: string | null;
}

// ---------- reports ----------
export interface PnlRow {
  section: string;
  category_group: string;
  gl_account_id: string;
  account_number: string | null;
  account_name: string;
  amount: Num;
}
export interface PnlMonthRow extends PnlRow {
  month: string;
}
export interface PnlProjectRow {
  project_id: string | null;
  project_name: string;
  is_business: boolean;
  income: Num;
  spending: Num;
  net: Num;
}
export interface BalanceRow {
  gl_account_id: string;
  account_number: string | null;
  account_name: string;
  account_type: GlAccountType;
  classification: Classification;
  balance: Num;
}
export interface TrialBalanceRow {
  gl_account_id: string | null;
  account_number: string | null;
  account_name: string;
  account_type: string;
  debit: Num;
  credit: Num;
}
export interface BalanceSheetRow {
  section: string;
  account_type: string;
  gl_account_id: string | null;
  account_number: string | null;
  account_name: string;
  balance: Num;
}
export interface GeneralLedgerRow {
  gl_account_id: string;
  account_number: string | null;
  account_name: string;
  txn_date: string;
  source: string;
  entry_type: LedgerEntryType | null;
  doc_number: string | null;
  party_name: string | null;
  project_name: string | null;
  memo: string | null;
  debit: Num;
  credit: Num;
  balance: Num;
  source_id: string | null;
}
export interface PayeeReportRow {
  payee_id: string | null;
  payee_name: string;
  spending: Num;
  income: Num;
  entries: number;
}
export interface TaxSummaryRow {
  tax_line: string;
  amount: Num;
  lines: number;
}
export interface TaxDetailRow {
  tax_line: string;
  txn_date: string;
  account_name: string;
  party_name: string | null;
  project_name: string | null;
  memo: string | null;
  amount: Num;
  source_id: string;
}
export interface NetWorthPoint {
  month_end: string;
  cash: Num;
  invested: Num;
  other_assets: Num;
  cards: Num;
  loans: Num;
  assets: Num;
  liabilities: Num;
  net_worth: Num;
}
export interface LedgerException {
  source: string;
  source_id: string;
  doc_number: string | null;
  txn_date: string;
  out_of_balance: Num;
  problem: string;
}
export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  table_name: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  row_id: string | null;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

// ---------- reconciliation ----------
export interface Reconciliation {
  id: string;
  gl_account_id: string;
  statement_date: string;
  statement_ending_balance: Num;
  status: "in_progress" | "completed";
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
  created_at: string;
}
export interface ReconciliationStatus extends Reconciliation {
  account_name: string;
  account_type: GlAccountType;
  classification: Classification;
  beginning_balance: Num;
  cleared_net: Num;
  difference: Num;
}
export interface ReconciliationItem {
  reconciliation_id: string;
  gl_account_id: string;
  source: string;
  source_id: string;
}
export interface UnclearedRow {
  gl_account_id: string;
  account_name: string;
  source: string;
  source_id: string;
  txn_date: string;
  doc_number: string | null;
  party_name: string | null;
  memo: string | null;
  amount: Num;
}

// ---------- bank feed ----------
export interface BankFeedAccount {
  id: string;
  era_account_key: string;
  name: string;
  institution: string | null;
  mask: string | null;
  account_type: string | null;
  gl_account_id: string | null;
  is_active: boolean;
  balance_only: boolean;
  auto_value: boolean;
  balance: Num;
  balance_as_of: string | null;
  last_synced_at: string | null;
  // v_bank_feed_accounts
  gl_account_name: string | null;
  gl_account_number: string | null;
  gl_account_type: GlAccountType | null;
  gl_classification: Classification | null;
  books_balance: Num;
  for_review: number;
}
export interface BankFeedState {
  id: number;
  sync_started_at: string | null;
  last_sync_at: string | null;
  last_status: string | null;
  last_error: string | null;
}
export interface BankSuggestion {
  rule_id: string;
  gl_account_id: string | null;
  project_id: string | null;
  payee_id: string | null;
  memo: string | null;
}
export interface BankTransaction {
  id: string;
  era_id: string;
  feed_account_id: string;
  txn_date: string;
  amount: Num;
  description: string | null;
  original_description: string | null;
  merchant: string | null;
  era_category: string | null;
  transfer_era_id: string | null;
  status: "new" | "matched" | "added" | "excluded";
  suggestion: BankSuggestion | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // v_bank_transactions
  account_name: string;
  account_mask: string | null;
  gl_account_id: string | null;
  links: { source: string; source_id: string; created: boolean }[] | null;
}
export interface BankRule {
  id: string;
  contains: string;
  feed_account_id: string | null;
  direction: "in" | "out" | null;
  gl_account_id: string;
  project_id: string | null;
  payee_id: string | null;
  memo: string | null;
  auto_add: boolean;
  position: number;
  is_active: boolean;
  times_used: number;
}
export interface BankCandidate {
  kind: string;
  source: string;
  source_id: string;
  txn_date: string;
  label: string;
  amount: Num;
  days: number;
}
export interface EraAccount {
  key: string;
  name: string;
  institution: string | null;
  mask: string | null;
  type: string | null;
  balance: number | null;
  balance_as_of: string | null;
}

// ---------- budgets ----------
export interface BudgetAmount {
  id: string;
  gl_account_id: string;
  month: string | null;
  amount: Num;
}
export interface BudgetRow {
  section: string;
  category_group: string;
  gl_account_id: string;
  account_number: string | null;
  account_name: string;
  budget: Num;
  budget_is_override: boolean;
  actual: Num;
  remaining: Num;
  avg_3mo: Num;
}
export interface BudgetYearRow {
  month: string;
  gl_account_id: string;
  budget: Num;
  actual: Num;
}

// ---------- recurring ----------
export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "yearly";
export interface RecurringBill {
  id: string;
  name: string;
  is_income: boolean;
  payee_id: string | null;
  gl_account_id: string | null;
  amount: Num;
  cadence: Cadence;
  match_text: string | null;
  feed_account_id: string | null;
  next_due: string | null;
  autopay: boolean;
  is_active: boolean;
  notes: string | null;
  // v_recurring_bills
  last_seen: string | null;
  last_amount: Num;
  times_seen: number;
  next_expected: string | null;
  payee_name: string | null;
  account_name: string | null;
  monthly_amount: Num;
  state: "paused" | "unknown" | "late" | "due soon" | "upcoming";
  days_until: number | null;
}
export interface RecurringCandidate {
  merchant_key: string;
  sample: string;
  is_income: boolean;
  times: number;
  avg_amount: Num;
  last_amount: Num;
  min_amount: Num;
  max_amount: Num;
  cadence: Cadence;
  median_gap: Num;
  last_seen: string;
  next_expected: string;
  feed_account_id: string | null;
  gl_account_id: string | null;
}

// ---------- home ----------
export interface HomeAccount {
  id: string;
  number: string | null;
  name: string;
  type: GlAccountType;
  classification: Classification;
  balance: Num;
  bank_balance: Num;
  bank_balance_as_of: string | null;
  for_review: number;
  linked: boolean;
  last_synced_at: string | null;
}
export interface AttentionItem {
  kind: string;
  tone: "high" | "medium" | "low";
  title: string;
  detail: string;
  link: string;
}
export interface HomeSummary {
  accounts: HomeAccount[];
  totals: {
    cash: Num;
    invested: Num;
    other_assets: Num;
    cards: Num;
    loans: Num;
    assets: Num;
    liabilities: Num;
    net_worth: Num;
  };
  month: {
    income: Num;
    spending: Num;
    last_income: Num;
    last_spending: Num;
    start: string;
    last_start: string;
    last_end: string;
  };
  budget: {
    budgeted: Num;
    spent_in_budget: Num;
    spent: Num;
    income_budget: Num;
    over: { id: string; name: string; budget: Num; actual: Num }[];
  };
  spending_by_group: { group: string; amount: Num }[];
  cashflow: { month: string; income: Num; spending: Num }[];
  net_worth_series: NetWorthPoint[];
  upcoming: {
    id: string;
    name: string;
    amount: Num;
    is_income: boolean;
    next_expected: string;
    state: RecurringBill["state"];
    days_until: number;
    autopay: boolean;
  }[];
  recurring: { monthly_bills: Num; monthly_income: Num; count: number };
  feed: BankFeedState | null;
  attention: AttentionItem[];
}
