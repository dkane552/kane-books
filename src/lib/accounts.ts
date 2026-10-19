// What the account types mean and how they group, shared by every page.
import type { GlAccount, GlAccountType } from "./types";

export const ASSET_TYPES: GlAccountType[] = [
  "Bank",
  "Investment",
  "Retirement",
  "Property",
  "Vehicle",
  "Other Asset",
];
export const LIABILITY_TYPES: GlAccountType[] = [
  "Credit Card",
  "Loan",
  "Mortgage",
  "Other Liability",
];
/** Accounts money moves through: what you own and what you owe (a line to one makes a transfer). */
export const BALANCE_TYPES: GlAccountType[] = [...ASSET_TYPES, ...LIABILITY_TYPES];
/** Accounts the bank feed and reconciliation work with. */
export const FEED_TYPES: GlAccountType[] = [
  "Bank",
  "Credit Card",
  "Loan",
  "Mortgage",
  "Investment",
  "Retirement",
  "Other Liability",
];
export const CATEGORY_TYPES: GlAccountType[] = [
  "Income",
  "Expense",
  "Other Income",
  "Other Expense",
];
export const ALL_TYPES: GlAccountType[] = [...BALANCE_TYPES, "Equity", ...CATEGORY_TYPES];
/** Their value moves on its own (markets, home prices), so they get value updates. */
export const VALUED_TYPES: GlAccountType[] = [
  "Investment",
  "Retirement",
  "Property",
  "Vehicle",
  "Other Asset",
];

export const TYPE_LABEL: Record<GlAccountType, string> = {
  Bank: "Bank and cash",
  Investment: "Investments",
  Retirement: "Retirement",
  Property: "Real estate",
  Vehicle: "Vehicles",
  "Other Asset": "Other assets",
  "Credit Card": "Credit cards",
  Loan: "Loans",
  Mortgage: "Mortgages",
  "Other Liability": "Other debts",
  Equity: "Net worth",
  Income: "Income",
  Expense: "Spending",
  "Other Income": "Other income",
  "Other Expense": "Other spending",
};

/** The tax lines the starting chart uses, plus a few common ones, for the pickers. */
export const TAX_LINES = [
  "Wages (W-2)",
  "Business distributions (K-1)",
  "Interest income (1099-INT)",
  "Dividends (1099-DIV)",
  "Capital gains (1099-B)",
  "Business income (Schedule C)",
  "Business expenses (Schedule C)",
  "Rental income (Schedule E)",
  "Rental expenses (Schedule E)",
  "Mortgage interest (Schedule A)",
  "State and local taxes (Schedule A)",
  "Charitable contributions (Schedule A)",
  "Medical (Schedule A)",
  "Student loan interest",
  "Retirement contributions (IRA)",
  "HSA contributions",
  "Education expenses",
  "Federal tax payments",
  "State tax payments",
];

export const CATEGORY_GROUPS = [
  "Income",
  "Housing",
  "Utilities",
  "Food",
  "Transportation",
  "Health",
  "Personal",
  "Financial",
  "Education",
  "Taxes",
  "Business",
  "Value changes",
  "Other",
];

export const glLabel = (a: Pick<GlAccount, "number" | "name">) =>
  a.number ? `${a.number} ${a.name}` : a.name;

/** Accounts where a credit adds (owed, net worth, income). */
export const creditNormal = (t: GlAccountType | undefined) =>
  !!t && (LIABILITY_TYPES.includes(t) || t === "Equity" || t === "Income" || t === "Other Income");
