/**
 * Tax pack: one Excel workbook for the year, built in the browser from the books, for the CPA.
 * Sheets: Summary (checks and totals), Tax Lines, Tax Detail, Businesses (a Schedule C view of each
 * business project), Income and Spending, Net Worth, General Ledger, Reconciliations.
 * Totals are live formulas.
 */
import { Workbook, type CellStyle, type Sheet } from "./xlsx";
import type {
  BalanceSheetRow,
  GeneralLedgerRow,
  PnlRow,
  TaxDetailRow,
  TaxSummaryRow,
  TrialBalanceRow,
} from "./types";

export interface ReconStatus {
  account_name: string;
  account_type: string;
  last_reconciled: string | null;
  statement_balance: number | null;
}

export interface BusinessPnl {
  name: string;
  rows: PnlRow[];
}

export interface TaxPackData {
  owner: string;
  year: number;
  start: string;
  end: string;
  closedThrough: string | null;
  generatedAt: string;
  exceptions: number;
  tb: TrialBalanceRow[];
  pl: PnlRow[];
  bsStart: BalanceSheetRow[];
  bsEnd: BalanceSheetRow[];
  gl: GeneralLedgerRow[];
  tax: TaxSummaryRow[];
  taxDetail: TaxDetailRow[];
  businesses: BusinessPnl[];
  recon: ReconStatus[];
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

const HEADER: CellStyle = {
  bold: true,
  color: "FFFFFF",
  fill: "26384F",
  align: "center",
  wrap: true,
};
const SECTION: CellStyle = { bold: true, fill: "EEE8DC" };
const MONEY: CellStyle = { fmt: "money" };
const SUB: CellStyle = { fmt: "money", bold: true, border: "sub" };
const TOTAL: CellStyle = { fmt: "money", bold: true, border: "total" };
const NOTE: CellStyle = { italic: true, color: "555555" };
const FIRST = 5;

function reportSheet(
  wb: Workbook,
  name: string,
  title: string,
  subtitle: string,
  headers: string[],
  widths: number[],
): Sheet {
  const ws = wb.addSheet(name);
  ws.set(1, 1, title, { bold: true, size: 14 });
  ws.set(2, 1, subtitle, NOTE);
  headers.forEach((h, i) => ws.set(4, i + 1, h, HEADER));
  ws.widths = widths;
  ws.freezeRows = 4;
  return ws;
}

/** Income and spending lines by section, with section totals; returns the row of net. */
function pnlBlock(ws: Sheet, startRow: number, rows: PnlRow[]): { next: number; net: number } {
  let r = startRow;
  const totals: Record<string, number> = {};
  for (const section of ["Income", "Spending", "Other income", "Other spending"]) {
    const items = rows.filter((x) => x.section === section);
    if (!items.length) continue;
    ws.set(r, 1, section, SECTION)
      .set(r, 2, null, SECTION)
      .set(r, 3, null, SECTION)
      .set(r, 4, null, SECTION);
    r++;
    const first = r;
    for (const x of items) {
      ws.set(r, 1, x.category_group)
        .set(r, 2, x.account_number)
        .set(r, 3, x.account_name)
        .set(r, 4, n(x.amount), MONEY);
      r++;
    }
    ws.set(r, 3, `Total ${section.toLowerCase()}`, { bold: true }).set(
      r,
      4,
      { f: `SUM(D${first}:D${r - 1})` },
      SUB,
    );
    totals[section] = r++;
    r++;
  }
  const t = (s: string) => (totals[s] ? `D${totals[s]}` : "0");
  ws.set(r, 3, "Net (income less spending)", { bold: true }).set(
    r,
    4,
    { f: `${t("Income")}-${t("Spending")}+${t("Other income")}-${t("Other spending")}` },
    TOTAL,
  );
  return { next: r + 2, net: r };
}

export function buildTaxPack(d: TaxPackData): Uint8Array {
  const wb = new Workbook();
  const summary = wb.addSheet("Summary");
  const period = `${longDate(d.start)} to ${longDate(d.end)}`;
  const src = `Source: Kane Books, ${d.generatedAt}`;

  // ---------- Tax Lines ----------
  let ws = reportSheet(
    wb,
    "Tax Lines",
    `${d.owner}: Tax summary ${d.year}`,
    `${period}. Income and deductions by the tax line set on each category (or line). ${src}`,
    ["Tax line", "Amount", "Lines"],
    [44, 18, 10],
  );
  let r = FIRST;
  for (const x of d.tax) {
    ws.set(r, 1, x.tax_line).set(r, 2, n(x.amount), MONEY).set(r, 3, Number(x.lines));
    r++;
  }
  if (!d.tax.length) ws.set(r++, 1, "Nothing on a tax line this year.", NOTE);
  ws.set(r + 1, 1, "Check each figure against the forms you receive (W-2, 1099, 1098, K-1).", NOTE);

  // ---------- Tax Detail ----------
  ws = reportSheet(
    wb,
    "Tax Detail",
    `${d.owner}: Tax detail ${d.year}`,
    `${period}. Every transaction behind the tax summary. ${src}`,
    ["Tax line", "Date", "Category", "Payee", "Project", "Memo", "Amount"],
    [36, 12, 28, 26, 20, 40, 16],
  );
  r = FIRST;
  let lastLine = "";
  let first = r;
  const closeLine = () => {
    if (!lastLine) return;
    ws.set(r, 6, `Total ${lastLine}`, { bold: true }).set(
      r,
      7,
      { f: `SUM(G${first}:G${r - 1})` },
      SUB,
    );
    r += 2;
  };
  for (const x of d.taxDetail) {
    if (x.tax_line !== lastLine) {
      closeLine();
      lastLine = x.tax_line;
      ws.set(r, 1, x.tax_line, SECTION);
      r++;
      first = r;
    }
    ws.set(r, 1, x.tax_line)
      .set(r, 2, { date: x.txn_date }, { fmt: "date" })
      .set(r, 3, x.account_name)
      .set(r, 4, x.party_name)
      .set(r, 5, x.project_name)
      .set(r, 6, x.memo)
      .set(r, 7, n(x.amount), MONEY);
    r++;
  }
  closeLine();

  // ---------- Businesses ----------
  ws = reportSheet(
    wb,
    "Businesses",
    `${d.owner}: Business projects ${d.year}`,
    `${period}. Income and spending tagged to each project marked as a business, for Schedule C. ${src}`,
    ["Group", "Acct #", "Category", "Amount"],
    [18, 10, 36, 18],
  );
  r = FIRST;
  const bizNets: { name: string; row: number }[] = [];
  for (const b of d.businesses) {
    ws.set(r, 1, b.name, { bold: true, size: 12 });
    r += 1;
    if (!b.rows.length) {
      ws.set(r, 1, "No activity this year.", NOTE);
      r += 2;
      continue;
    }
    const block = pnlBlock(ws, r, b.rows);
    bizNets.push({ name: b.name, row: block.net });
    r = block.next;
  }
  if (!d.businesses.length) ws.set(r, 1, "No projects are marked as a business.", NOTE);

  // ---------- Income and Spending ----------
  ws = reportSheet(
    wb,
    "Income and Spending",
    `${d.owner}: Income and spending ${d.year}`,
    `${period}. ${src}`,
    ["Group", "Acct #", "Category", "Amount"],
    [18, 10, 36, 18],
  );
  const pl = pnlBlock(ws, FIRST, d.pl);

  // ---------- Net Worth ----------
  ws = reportSheet(
    wb,
    "Net Worth",
    `${d.owner}: Net worth`,
    `At the start and end of ${d.year}. ${src}`,
    ["Section", "Type", "Account", `Start (${longDate(d.start)})`, `End (${longDate(d.end)})`],
    [16, 18, 36, 20, 20],
  );
  r = FIRST;
  const nwRows: Record<string, number[]> = {};
  const keys = new Map<string, { section: string; type: string; name: string }>();
  for (const x of [...d.bsStart, ...d.bsEnd])
    keys.set(`${x.section}|${x.account_type}|${x.account_name}`, {
      section: x.section,
      type: x.account_type,
      name: x.account_name,
    });
  const pick = (list: BalanceSheetRow[], k: string) =>
    n(list.find((x) => `${x.section}|${x.account_type}|${x.account_name}` === k)?.balance) ?? 0;
  for (const section of ["What you own", "What you owe", "Net worth"]) {
    ws.set(r, 1, section, SECTION);
    for (let c = 2; c <= 5; c++) ws.set(r, c, null, SECTION);
    r++;
    const s0 = r;
    for (const [k, v] of keys) {
      if (v.section !== section) continue;
      ws.set(r, 1, section)
        .set(r, 2, v.type)
        .set(r, 3, v.name)
        .set(r, 4, pick(d.bsStart, k), MONEY)
        .set(r, 5, pick(d.bsEnd, k), MONEY);
      r++;
    }
    ws.set(r, 3, `Total ${section.toLowerCase()}`, { bold: true })
      .set(r, 4, r > s0 ? { f: `SUM(D${s0}:D${r - 1})` } : 0, SUB)
      .set(r, 5, r > s0 ? { f: `SUM(E${s0}:E${r - 1})` } : 0, SUB);
    nwRows[section] = [r];
    r += 2;
  }
  const own = nwRows["What you own"]![0]!;
  const owe = nwRows["What you owe"]![0]!;
  const nwRow = r;
  ws.set(r, 3, "Net worth (own less owe)", { bold: true })
    .set(r, 4, { f: `D${own}-D${owe}` }, TOTAL)
    .set(r, 5, { f: `E${own}-E${owe}` }, TOTAL);

  // ---------- General Ledger ----------
  ws = reportSheet(
    wb,
    "General Ledger",
    `${d.owner}: General ledger ${d.year}`,
    `${period}. Every line in the books, by account. ${src}`,
    [
      "Acct #",
      "Account",
      "Date",
      "Type",
      "Ref",
      "Payee",
      "Project",
      "Memo",
      "Debit",
      "Credit",
      "Balance",
    ],
    [9, 28, 12, 12, 10, 24, 18, 40, 14, 14, 14],
  );
  r = FIRST;
  for (const x of d.gl) {
    ws.set(r, 1, x.account_number)
      .set(r, 2, x.account_name)
      .set(r, 3, { date: x.txn_date }, { fmt: "date" })
      .set(
        r,
        4,
        x.source === "Beginning balance" ? "Beginning balance" : (x.entry_type ?? x.source),
      )
      .set(r, 5, x.doc_number)
      .set(r, 6, x.party_name)
      .set(r, 7, x.project_name)
      .set(r, 8, x.memo)
      .set(r, 9, n(x.debit), MONEY)
      .set(r, 10, n(x.credit), MONEY)
      .set(r, 11, n(x.balance), MONEY);
    r++;
  }

  // ---------- Reconciliations ----------
  ws = reportSheet(
    wb,
    "Reconciliations",
    `${d.owner}: Reconciliation status`,
    `Bank, card and loan accounts and the last statement each was reconciled to. ${src}`,
    ["Account", "Type", "Reconciled through", "Statement balance"],
    [36, 18, 20, 20],
  );
  r = FIRST;
  for (const x of d.recon) {
    ws.set(r, 1, x.account_name)
      .set(r, 2, x.account_type)
      .set(
        r,
        3,
        x.last_reconciled ? { date: x.last_reconciled } : "Never",
        x.last_reconciled ? { fmt: "date" } : {},
      )
      .set(r, 4, x.statement_balance, MONEY);
    r++;
  }

  // ---------- Summary (first sheet) ----------
  const dr = d.tb.reduce((s, x) => s + (n(x.debit) ?? 0), 0);
  const cr = d.tb.reduce((s, x) => s + (n(x.credit) ?? 0), 0);
  summary.widths = [44, 22, 60];
  summary.set(1, 1, `${d.owner}: Tax pack ${d.year}`, { bold: true, size: 16 });
  summary.set(2, 1, period, NOTE);
  summary.set(3, 1, src, NOTE);
  r = 5;
  summary.set(r, 1, "Totals", SECTION).set(r, 2, null, SECTION).set(r, 3, null, SECTION);
  r++;
  summary
    .set(r, 1, "Net, income less spending")
    .set(r, 2, { f: `'Income and Spending'!D${pl.net}` }, MONEY);
  r++;
  for (const b of bizNets) {
    summary.set(r, 1, `Net from ${b.name}`).set(r, 2, { f: `'Businesses'!D${b.row}` }, MONEY);
    r++;
  }
  summary.set(r, 1, "Net worth at year end").set(r, 2, { f: `'Net Worth'!E${nwRow}` }, MONEY);
  r++;
  summary
    .set(r, 1, "Change in net worth")
    .set(r, 2, { f: `'Net Worth'!E${nwRow}-'Net Worth'!D${nwRow}` }, MONEY);
  r += 2;
  summary.set(r, 1, "Checks", SECTION).set(r, 2, null, SECTION).set(r, 3, null, SECTION);
  r++;
  const checks: [string, string, string][] = [
    [
      "Debits equal credits at year end",
      Math.abs(dr - cr) < 0.005 ? "Yes" : "No",
      Math.abs(dr - cr) < 0.005 ? "" : `Off by ${(dr - cr).toFixed(2)}`,
    ],
    [
      "Entries that do not balance",
      String(d.exceptions),
      d.exceptions ? "Fix them in Settings > Books before sending." : "",
    ],
    [
      "Books closed through",
      d.closedThrough ? longDate(d.closedThrough) : "Not closed",
      d.closedThrough && d.closedThrough >= d.end
        ? ""
        : "Close the year so nothing changes after you send it.",
    ],
    [
      "Accounts not reconciled through year end",
      String(d.recon.filter((x) => !x.last_reconciled || x.last_reconciled < d.end).length),
      d.recon
        .filter((x) => !x.last_reconciled || x.last_reconciled < d.end)
        .map((x) => x.account_name)
        .join(", "),
    ],
  ];
  for (const [a, b, c] of checks) {
    summary.set(r, 1, a).set(r, 2, b, { bold: true }).set(r, 3, c, NOTE);
    r++;
  }
  r++;
  summary.set(
    r,
    1,
    "Investment values are as last updated in the app; use the brokerage statements for gains and basis.",
    NOTE,
  );
  return wb.bytes();
}
