// Reports: income and spending, month by month, by project, by payee, net worth, trial balance, general
// ledger and the tax summary, plus the tax pack for the CPA. Every report is a database function in
// supabase/2_ledger.sql; the page only lays them out.
import { Fragment, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  EmptyState,
  Field,
  FormDialog,
  LoadingRows,
  Money,
  PageHeading,
  Panel,
  Select,
} from "./shared";
import { ENTRY_KIND, PeekName, usePeek } from "./peek";
import { CashflowChart, NetWorthChart } from "./charts";
import { AccountOptions } from "./pickers";
import { rpcRows, useGlAccounts, useReport, useSettings } from "@/lib/data";
import { supabase, unwrap } from "@/lib/supabase";
import { addMonths, fmtDate, fmtMonth, money, num, todayISO } from "@/lib/format";
import { creditNormal } from "@/lib/accounts";
import { buildTaxPack, type ReconStatus } from "@/lib/tax-pack";
import type {
  BalanceSheetRow,
  GeneralLedgerRow,
  GlAccount,
  NetWorthPoint,
  PayeeReportRow,
  PnlMonthRow,
  PnlProjectRow,
  PnlRow,
  Project,
  ReconciliationStatus,
  TaxDetailRow,
  TaxSummaryRow,
  TrialBalanceRow,
} from "@/lib/types";

export const REPORTS = [
  "Income and Spending",
  "By Month",
  "By Project",
  "By Payee",
  "Net Worth",
  "Tax Summary",
  "General Ledger",
  "Trial Balance",
] as const;
type ReportName = (typeof REPORTS)[number];
const PERIOD_REPORTS: ReportName[] = [
  "Income and Spending",
  "By Month",
  "By Project",
  "By Payee",
  "Tax Summary",
  "General Ledger",
];

export interface ReportLink {
  report?: string | undefined;
  account?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  asOf?: string | undefined;
  uncategorized?: string | undefined;
}

type Csv = { rows: (string | number)[][] };
const year = () => new Date().getFullYear();
const PRESETS: Record<string, () => [string, string]> = {
  "This month": () => [`${todayISO().slice(0, 7)}-01`, todayISO()],
  "Last month": () => {
    const s = addMonths(`${todayISO().slice(0, 7)}-01`, -1);
    const e = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0);
    return [s, `${s.slice(0, 8)}${String(e.getDate()).padStart(2, "0")}`];
  },
  "This year": () => [`${year()}-01-01`, todayISO()],
  "Last year": () => [`${year() - 1}-01-01`, `${year() - 1}-12-31`],
  "Last 12 months": () => [addMonths(`${todayISO().slice(0, 7)}-01`, -11), todayISO()],
};

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportsPage({ link }: { link: ReportLink }) {
  const navigate = useNavigate();
  const report: ReportName = (REPORTS as readonly string[]).includes(link.report ?? "")
    ? (link.report as ReportName)
    : "Income and Spending";
  const [from, setFrom] = useState(link.from ?? `${year()}-01-01`);
  const [to, setTo] = useState(link.to ?? todayISO());
  const [asOf, setAsOf] = useState(link.asOf ?? todayISO());
  const [pack, setPack] = useState(false);
  const csv = useRef<Csv>({ rows: [] }).current;
  const isPeriod = PERIOD_REPORTS.includes(report);
  const setReport = (r: string) =>
    navigate({ to: "/reports", search: { report: r }, replace: true });

  return (
    <>
      <PageHeading
        title="Reports"
        eyebrow="THE BOOKS"
        subtitle="Where money came from and went, what you own and owe, and what the CPA needs."
      >
        <Button size="sm" onClick={() => setPack(true)}>
          <FileSpreadsheet />
          Tax pack
        </Button>
      </PageHeading>
      <Panel>
        <div className="toolbar">
          <select aria-label="Report" value={report} onChange={(e) => setReport(e.target.value)}>
            {REPORTS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          {isPeriod ? (
            <>
              <select
                aria-label="Period"
                value=""
                onChange={(e) => {
                  const p = PRESETS[e.target.value];
                  if (p) {
                    const [f, t] = p();
                    setFrom(f);
                    setTo(t);
                  }
                }}
              >
                <option value="">Period...</option>
                {Object.keys(PRESETS).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <Input
                type="date"
                className="w-auto"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                className="w-auto"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To"
              />
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">As of</span>
              <Input
                type="date"
                className="w-auto"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                aria-label="As of"
              />
            </>
          )}
          <div className="toolbar-end ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `kane-books-${report.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
                  csv.rows,
                )
              }
            >
              <Download />
              Export CSV
            </Button>
          </div>
        </div>
        {report === "Income and Spending" && <PnlReport from={from} to={to} csv={csv} />}
        {report === "By Month" && <ByMonthReport from={from} to={to} csv={csv} />}
        {report === "By Project" && <ByProjectReport from={from} to={to} csv={csv} />}
        {report === "By Payee" && <ByPayeeReport from={from} to={to} csv={csv} />}
        {report === "Net Worth" && <NetWorthReport asOf={asOf} csv={csv} />}
        {report === "Tax Summary" && <TaxReport from={from} to={to} csv={csv} />}
        {report === "General Ledger" && (
          <GeneralLedgerReport
            from={from}
            to={to}
            csv={csv}
            initialAccount={link.account}
            uncategorized={link.uncategorized === "1"}
          />
        )}
        {report === "Trial Balance" && <TrialBalanceReport asOf={asOf} csv={csv} />}
      </Panel>
      {pack && <TaxPackDialog onClose={() => setPack(false)} />}
    </>
  );
}

function ReportError({ error }: { error: unknown }) {
  return (
    <EmptyState
      compact
      title="Could not run the report"
      description={error instanceof Error ? error.message : String(error)}
    />
  );
}

// ---------- income and spending ----------
type Line = { id: string | null; label: string; group?: string; values: number[] };
function Statement({
  sections,
  headers,
  period,
  netLabel = "Saved (income less spending)",
}: {
  sections: { title: string; lines: Line[]; sign: 1 | -1 }[];
  headers: string[];
  period?: { from: string; to: string } | undefined;
  netLabel?: string | null;
}) {
  const { show } = usePeek();
  const width = headers.length;
  const zero = () => Array.from({ length: width }, () => 0);
  const net = zero();
  return (
    <div className="data-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            {headers.map((h) => (
              <th key={h} className="numeric">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections
            .filter((s) => s.lines.length)
            .map((s) => {
              const total = s.lines.reduce(
                (acc, l) => acc.map((x, i) => x + (l.values[i] ?? 0)),
                zero(),
              );
              total.forEach((v, i) => (net[i] = (net[i] ?? 0) + s.sign * v));
              let lastGroup = "";
              return (
                <Fragment key={s.title}>
                  <tr className="bg-muted">
                    <td colSpan={width + 1} className="font-semibold">
                      {s.title}
                    </td>
                  </tr>
                  {s.lines.map((l, i) => {
                    const head =
                      l.group && l.group !== lastGroup && s.lines.some((x) => x.group !== l.group);
                    lastGroup = l.group ?? "";
                    const target = l.id
                      ? ({ kind: "gl", id: l.id, ...period } as const)
                      : undefined;
                    return (
                      <Fragment key={`${l.id ?? l.label}-${i}`}>
                        {head && (
                          <tr>
                            <td
                              colSpan={width + 1}
                              className="pl-4 pt-3 text-[length:calc(10px*var(--ts,1))] font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              {l.group}
                            </td>
                          </tr>
                        )}
                        <tr
                          className={target ? "cursor-pointer hover:bg-muted/60" : ""}
                          onClick={target ? () => show(target) : undefined}
                        >
                          <td className="pl-6">
                            <PeekName target={target}>{l.label}</PeekName>
                          </td>
                          {l.values.map((v, j) => (
                            <td key={j} className="text-right">
                              <Money value={v} blankZero />
                            </td>
                          ))}
                        </tr>
                      </Fragment>
                    );
                  })}
                  <tr className="font-medium">
                    <td>Total {s.title.toLowerCase()}</td>
                    {total.map((v, j) => (
                      <td key={j} className="text-right">
                        <Money value={v} />
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
          {netLabel && (
            <tr className="border-t-2 font-semibold">
              <td>{netLabel}</td>
              {net.map((v, j) => (
                <td key={j} className="text-right">
                  <Money value={v} />
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const SECTIONS: { title: string; sign: 1 | -1 }[] = [
  { title: "Income", sign: 1 },
  { title: "Spending", sign: -1 },
  { title: "Other income", sign: 1 },
  { title: "Other spending", sign: -1 },
];

function PnlReport({ from, to, csv }: { from: string; to: string; csv: Csv }) {
  const q = useReport<PnlRow>("report_profit_and_loss", { p_from: from, p_to: to });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ReportError error={q.error} />;
  const rows = q.data ?? [];
  csv.rows = [
    ["Section", "Group", "Acct #", "Category", "Amount"],
    ...rows.map((r) => [
      r.section,
      r.category_group,
      r.account_number ?? "",
      r.account_name,
      num(r.amount),
    ]),
  ];
  if (!rows.length) return <EmptyState compact title="No income or spending in this period" />;
  return (
    <Statement
      headers={[`${fmtDate(from)} to ${fmtDate(to)}`]}
      period={{ from, to }}
      sections={SECTIONS.map((s) => ({
        ...s,
        lines: rows
          .filter((r) => r.section === s.title)
          .map((r) => ({
            id: r.gl_account_id,
            label: r.account_name,
            group: r.category_group,
            values: [num(r.amount)],
          })),
      }))}
    />
  );
}

function ByMonthReport({ from, to, csv }: { from: string; to: string; csv: Csv }) {
  const navigate = useNavigate();
  const q = useReport<PnlMonthRow>("report_pl_by_month", { p_from: from, p_to: to });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const months = useMemo(() => {
    const out: string[] = [];
    for (let m = `${from.slice(0, 7)}-01`; m <= to; m = addMonths(m, 1)) out.push(m);
    return out.slice(-24);
  }, [from, to]);
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ReportError error={q.error} />;
  csv.rows = [
    ["Month", "Section", "Group", "Category", "Amount"],
    ...rows.map((r) => [r.month, r.section, r.category_group, r.account_name, num(r.amount)]),
  ];
  const cash = months.map((m) => ({
    month: m,
    income: rows
      .filter((r) => r.month === m && r.section === "Income")
      .reduce((s, r) => s + num(r.amount), 0),
    spending: rows
      .filter((r) => r.month === m && r.section === "Spending")
      .reduce((s, r) => s + num(r.amount), 0),
  }));
  const lines = (section: string) => {
    const ids = [...new Set(rows.filter((r) => r.section === section).map((r) => r.gl_account_id))];
    return ids.map((id) => {
      const any = rows.find((r) => r.gl_account_id === id)!;
      return {
        id,
        label: any.account_name,
        group: any.category_group,
        values: [
          ...months.map((m) =>
            num(rows.find((r) => r.gl_account_id === id && r.month === m)?.amount),
          ),
          rows.filter((r) => r.gl_account_id === id).reduce((s, r) => s + num(r.amount), 0),
        ],
      };
    });
  };
  if (!rows.length) return <EmptyState compact title="No income or spending in this period" />;
  return (
    <>
      <div className="pt-4">
        <CashflowChart
          data={cash}
          onMonth={(m) => navigate({ to: "/budget", search: { month: m.slice(0, 7) } })}
        />
      </div>
      <Statement
        headers={[...months.map((m) => fmtMonth(m, true)), "Total"]}
        period={{ from, to }}
        sections={SECTIONS.map((s) => ({ ...s, lines: lines(s.title) }))}
      />
    </>
  );
}

function ByProjectReport({ from, to, csv }: { from: string; to: string; csv: Csv }) {
  const q = useReport<PnlProjectRow>("report_pl_by_project", { p_from: from, p_to: to });
  const { show } = usePeek();
  csv.rows = [
    ["Project", "Business", "Income", "Spending", "Net"],
    ...(q.data ?? []).map((r) => [
      r.project_name,
      r.is_business ? "Yes" : "No",
      num(r.income),
      num(r.spending),
      num(r.net),
    ]),
  ];
  if (q.error) return <ReportError error={q.error} />;
  return (
    <DataTable
      rows={q.data}
      loading={q.isLoading}
      rowKey={(r) => r.project_id ?? "none"}
      onRowClick={(r) => r.project_id && show({ kind: "project", id: r.project_id })}
      columns={[
        {
          key: "p",
          header: "Project",
          sortValue: (r) => r.project_name,
          render: (r) => r.project_name,
        },
        {
          key: "b",
          header: "Kind",
          render: (r) => (r.project_id ? (r.is_business ? "Business" : "Personal") : ""),
        },
        {
          key: "i",
          header: "Income",
          numeric: true,
          sortValue: (r) => num(r.income),
          render: (r) => <Money value={r.income} blankZero />,
        },
        {
          key: "s",
          header: "Spending",
          numeric: true,
          sortValue: (r) => num(r.spending),
          render: (r) => <Money value={r.spending} blankZero />,
        },
        {
          key: "n",
          header: "Net",
          numeric: true,
          sortValue: (r) => num(r.net),
          render: (r) => <Money value={r.net} />,
        },
      ]}
      empty={<EmptyState compact title="No activity in this period" />}
      footerNote={`Net for everything ${money((q.data ?? []).reduce((s, r) => s + num(r.net), 0))}`}
    />
  );
}

function ByPayeeReport({ from, to, csv }: { from: string; to: string; csv: Csv }) {
  const q = useReport<PayeeReportRow>("report_by_payee", { p_from: from, p_to: to });
  const { show } = usePeek();
  csv.rows = [
    ["Payee", "Spending", "Income", "Entries"],
    ...(q.data ?? []).map((r) => [r.payee_name, num(r.spending), num(r.income), r.entries]),
  ];
  if (q.error) return <ReportError error={q.error} />;
  return (
    <DataTable
      rows={q.data}
      loading={q.isLoading}
      rowKey={(r) => r.payee_id ?? "none"}
      initialSort={{ key: "s", dir: "desc" }}
      onRowClick={(r) => r.payee_id && show({ kind: "payee", id: r.payee_id })}
      columns={[
        { key: "p", header: "Payee", sortValue: (r) => r.payee_name, render: (r) => r.payee_name },
        {
          key: "s",
          header: "Spending",
          numeric: true,
          sortValue: (r) => num(r.spending),
          render: (r) => <Money value={r.spending} blankZero />,
        },
        {
          key: "i",
          header: "Income",
          numeric: true,
          sortValue: (r) => num(r.income),
          render: (r) => <Money value={r.income} blankZero />,
        },
        {
          key: "e",
          header: "Entries",
          numeric: true,
          sortValue: (r) => r.entries,
          render: (r) => <span className="number">{r.entries}</span>,
        },
      ]}
      empty={<EmptyState compact title="No activity in this period" />}
    />
  );
}

function NetWorthReport({ asOf, csv }: { asOf: string; csv: Csv }) {
  const q = useReport<BalanceSheetRow>("report_balance_sheet", { p_as_of: asOf });
  const series = useReport<NetWorthPoint>("report_net_worth_series", {
    p_from: addMonths(`${asOf.slice(0, 7)}-01`, -23),
    p_to: asOf,
  });
  const { show } = usePeek();
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ReportError error={q.error} />;
  const rows = q.data ?? [];
  csv.rows = [
    ["Section", "Type", "Account", "Balance"],
    ...rows.map((r) => [r.section, r.account_type, r.account_name, num(r.balance)]),
  ];
  const total = (s: string) =>
    rows.filter((r) => r.section === s).reduce((a, r) => a + num(r.balance), 0);
  const own = total("What you own");
  const owe = total("What you owe");
  return (
    <>
      <div className="metrics p-4">
        {[
          ["What you own", own],
          ["What you owe", owe],
          ["Net worth", own - owe],
        ].map(([t, v]) => (
          <section key={t as string} className="panel metric">
            <div className="metric-top">
              <span>{t}</span>
            </div>
            <div className="metric-value">{money(v as number)}</div>
          </section>
        ))}
      </div>
      {(series.data ?? []).length > 1 && <NetWorthChart data={series.data ?? []} />}
      <div className="data-scroll">
        <table className="data-table">
          <tbody>
            {["What you own", "What you owe", "Net worth"].map((s) => {
              const list = rows.filter((r) => r.section === s);
              return (
                <Fragment key={s}>
                  <tr className="bg-muted">
                    <td colSpan={2} className="font-semibold">
                      {s}
                    </td>
                  </tr>
                  {list.map((r, i) => (
                    <tr
                      key={`${r.account_name}-${i}`}
                      className={r.gl_account_id ? "cursor-pointer hover:bg-muted/60" : ""}
                      onClick={
                        r.gl_account_id
                          ? () => show({ kind: "gl", id: r.gl_account_id! })
                          : undefined
                      }
                    >
                      <td className="pl-6">
                        {r.account_name}
                        <span className="ml-2 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                          {r.account_type}
                        </span>
                      </td>
                      <td className="text-right">
                        <Money value={r.balance} />
                      </td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td>Total {s.toLowerCase()}</td>
                    <td className="text-right">
                      <Money value={total(s)} />
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          {Math.abs(own - owe - total("Net worth")) < 0.005
            ? "What you own less what you owe equals net worth."
            : `Out by ${money(own - owe - total("Net worth"))}. See Settings > Books.`}
        </span>
      </div>
    </>
  );
}

function TaxReport({ from, to, csv }: { from: string; to: string; csv: Csv }) {
  const q = useReport<TaxSummaryRow>("report_tax_summary", { p_from: from, p_to: to });
  const d = useReport<TaxDetailRow>("report_tax_detail", { p_from: from, p_to: to });
  const [open, setOpen] = useState<string | null>(null);
  const { show } = usePeek();
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ReportError error={q.error} />;
  csv.rows = [
    ["Tax line", "Date", "Category", "Payee", "Project", "Memo", "Amount"],
    ...(d.data ?? []).map((r) => [
      r.tax_line,
      r.txn_date,
      r.account_name,
      r.party_name ?? "",
      r.project_name ?? "",
      r.memo ?? "",
      num(r.amount),
    ]),
  ];
  if (!(q.data ?? []).length)
    return (
      <EmptyState
        compact
        title="Nothing on a tax line in this period"
        description="Set a tax line on a category (Accounts, Categories and accounts) or on one line of an entry."
      />
    );
  return (
    <div className="data-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Tax line</th>
            <th className="numeric">Lines</th>
            <th className="numeric">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((t) => (
            <Fragment key={t.tax_line}>
              <tr
                className="cursor-pointer hover:bg-muted/60"
                onClick={() => setOpen(open === t.tax_line ? null : t.tax_line)}
              >
                <td className="font-medium">{t.tax_line}</td>
                <td className="text-right">{t.lines}</td>
                <td className="text-right">
                  <Money value={t.amount} />
                </td>
              </tr>
              {open === t.tax_line &&
                (d.data ?? [])
                  .filter((r) => r.tax_line === t.tax_line)
                  .map((r, i) => (
                    <tr
                      key={i}
                      className="cursor-pointer text-[length:calc(11px*var(--ts,1))] hover:bg-muted/60"
                      onClick={() => show({ kind: "entry", id: r.source_id })}
                    >
                      <td className="pl-6">
                        {fmtDate(r.txn_date)} · {r.account_name}
                        {r.party_name ? ` · ${r.party_name}` : ""}
                        {r.memo ? ` · ${r.memo}` : ""}
                      </td>
                      <td />
                      <td className="text-right">
                        <Money value={r.amount} />
                      </td>
                    </tr>
                  ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="table-footer">
        <span>
          Click a line to see what is behind it. Check each against the forms you receive.
        </span>
      </div>
    </div>
  );
}

function GeneralLedgerReport({
  from,
  to,
  csv,
  initialAccount,
  uncategorized,
}: {
  from: string;
  to: string;
  csv: Csv;
  initialAccount?: string | undefined;
  uncategorized?: boolean;
}) {
  const { data: accounts } = useGlAccounts();
  const { data: settings } = useSettings();
  const unc = uncategorized ? (settings?.uncategorized_expense_gl_id ?? "") : "";
  const [account, setAccount] = useState(initialAccount ?? "");
  const chosen = account || unc;
  const { show } = usePeek();
  const q = useReport<GeneralLedgerRow>("report_general_ledger", {
    p_from: from,
    p_to: to,
    p_account: chosen || null,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  csv.rows = [
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
    ...rows.map((r) => [
      r.account_number ?? "",
      r.account_name,
      r.txn_date,
      r.entry_type ?? r.source,
      r.doc_number ?? "",
      r.party_name ?? "",
      r.project_name ?? "",
      r.memo ?? "",
      num(r.debit),
      num(r.credit),
      num(r.balance),
    ]),
  ];
  const groups = useMemo(() => {
    const m = new Map<string, GeneralLedgerRow[]>();
    for (const r of rows) m.set(r.gl_account_id, [...(m.get(r.gl_account_id) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  const acct = (id: string) => accounts?.find((a) => a.id === id) as GlAccount | undefined;
  return (
    <>
      <div className="toolbar">
        <select aria-label="Account" value={chosen} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Every account</option>
          <AccountOptions accounts={accounts} keep={chosen} />
        </select>
      </div>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.error ? (
        <ReportError error={q.error} />
      ) : !rows.length ? (
        <EmptyState compact title="No activity in this period" />
      ) : (
        <div className="data-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Payee</th>
                <th>Project</th>
                <th>Memo</th>
                <th className="numeric">Amount</th>
                <th className="numeric">Balance</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([id, list]) => {
                const a = acct(id);
                const cn = creditNormal(a?.account_type);
                return (
                  <Fragment key={id}>
                    <tr className="bg-muted">
                      <td colSpan={7} className="font-semibold">
                        <PeekName target={{ kind: "gl", id, from, to }}>
                          {list[0]?.account_name}
                        </PeekName>
                      </td>
                    </tr>
                    {list.map((r, i) => {
                      const amt = cn ? num(r.credit) - num(r.debit) : num(r.debit) - num(r.credit);
                      const target = r.source_id
                        ? ({ kind: "entry", id: r.source_id } as const)
                        : undefined;
                      return (
                        <tr
                          key={`${id}-${i}`}
                          className={target ? "cursor-pointer hover:bg-muted/60" : ""}
                          onClick={target ? () => show(target) : undefined}
                        >
                          <td>{r.source === "Beginning balance" ? "" : fmtDate(r.txn_date)}</td>
                          <td>
                            {r.source === "Beginning balance"
                              ? "Beginning balance"
                              : r.entry_type
                                ? ENTRY_KIND[r.entry_type]
                                : ""}
                          </td>
                          <td>{r.party_name}</td>
                          <td>{r.project_name}</td>
                          <td className="max-w-[260px] truncate">{r.memo}</td>
                          <td className="text-right">
                            {r.source === "Beginning balance" ? "" : <Money value={amt} />}
                          </td>
                          <td className="text-right">
                            <Money value={cn ? -num(r.balance) : r.balance} />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TrialBalanceReport({ asOf, csv }: { asOf: string; csv: Csv }) {
  const q = useReport<TrialBalanceRow>("report_trial_balance", { p_as_of: asOf });
  const { show } = usePeek();
  if (q.error) return <ReportError error={q.error} />;
  const rows = q.data ?? [];
  csv.rows = [
    ["Acct #", "Account", "Type", "Debit", "Credit"],
    ...rows.map((r) => [
      r.account_number ?? "",
      r.account_name,
      r.account_type,
      num(r.debit),
      num(r.credit),
    ]),
  ];
  const dr = rows.reduce((s, r) => s + num(r.debit), 0);
  const cr = rows.reduce((s, r) => s + num(r.credit), 0);
  return (
    <DataTable
      rows={q.data}
      loading={q.isLoading}
      rowKey={(r) => `${r.gl_account_id}|${r.account_name}`}
      showFooterRow
      onRowClick={(r) =>
        r.gl_account_id &&
        show({ kind: "gl", id: r.gl_account_id, from: `${asOf.slice(0, 4)}-01-01`, to: asOf })
      }
      columns={[
        { key: "acct", header: "Account", render: (r) => r.account_name, footer: "Total" },
        { key: "type", header: "Type", render: (r) => r.account_type },
        {
          key: "dr",
          header: "Debit",
          numeric: true,
          render: (r) => <Money value={r.debit} blankZero />,
          footer: <Money value={dr} />,
        },
        {
          key: "cr",
          header: "Credit",
          numeric: true,
          render: (r) => <Money value={r.credit} blankZero />,
          footer: <Money value={cr} />,
        },
      ]}
      empty={<EmptyState compact title="Nothing in the books yet" />}
      footerNote={
        Math.abs(dr - cr) < 0.005
          ? "Debits equal credits."
          : `Out of balance by ${money(dr - cr)}. See Settings > Books.`
      }
    />
  );
}

// ---------- the tax pack ----------
async function collectPack(y: number) {
  const settings = unwrap(
    await supabase.from("book_settings").select("*").eq("id", 1).maybeSingle(),
  ) as {
    owner_name: string;
    books_closed_through: string | null;
  } | null;
  const start = `${y}-01-01`;
  const end = `${y}-12-31`;
  // One report at a time: each reads the whole ledger.
  const tb = await rpcRows<TrialBalanceRow>("report_trial_balance", { p_as_of: end });
  const pl = await rpcRows<PnlRow>("report_profit_and_loss", { p_from: start, p_to: end });
  const bsStart = await rpcRows<BalanceSheetRow>("report_balance_sheet", {
    p_as_of: `${y - 1}-12-31`,
  });
  const bsEnd = await rpcRows<BalanceSheetRow>("report_balance_sheet", { p_as_of: end });
  const gl = await rpcRows<GeneralLedgerRow>("report_general_ledger", {
    p_from: start,
    p_to: end,
    p_account: null,
  });
  const tax = await rpcRows<TaxSummaryRow>("report_tax_summary", { p_from: start, p_to: end });
  const taxDetail = await rpcRows<TaxDetailRow>("report_tax_detail", { p_from: start, p_to: end });
  const projects = unwrap(
    await supabase.from("projects").select("*").eq("is_business", true).order("name"),
  ) as Project[];
  const businesses = [];
  for (const p of projects)
    businesses.push({
      name: p.name,
      rows: await rpcRows<PnlRow>("report_project_detail", {
        p_project: p.id,
        p_from: start,
        p_to: end,
      }),
    });
  const recons = unwrap(
    await supabase
      .from("v_reconciliation_status")
      .select("*")
      .eq("status", "completed")
      .lte("statement_date", end),
  ) as ReconciliationStatus[];
  const accts = unwrap(
    await supabase
      .from("gl_accounts")
      .select("*")
      .in("account_type", ["Bank", "Credit Card", "Loan", "Mortgage"])
      .eq("is_active", true),
  ) as GlAccount[];
  const exc = unwrap(await supabase.from("v_ledger_exceptions").select("source_id")) as unknown[];
  const recon: ReconStatus[] = accts
    .filter(
      (a) =>
        tb.some((t) => t.gl_account_id === a.id) || recons.some((r) => r.gl_account_id === a.id),
    )
    .map((a) => {
      const last = recons
        .filter((r) => r.gl_account_id === a.id)
        .sort((x, z) => z.statement_date.localeCompare(x.statement_date))[0];
      return {
        account_name: a.name,
        account_type: a.account_type,
        last_reconciled: last?.statement_date ?? null,
        statement_balance: last ? num(last.statement_ending_balance) : null,
      };
    });
  return {
    owner: settings?.owner_name ?? "Kane Books",
    year: y,
    start,
    end,
    closedThrough: settings?.books_closed_through ?? null,
    generatedAt: `generated ${new Date().toLocaleString("en-US")}`,
    exceptions: exc.length,
    tb,
    pl,
    bsStart,
    bsEnd,
    gl,
    tax,
    taxDetail,
    businesses,
    recon,
  };
}

function TaxPackDialog({ onClose }: { onClose: () => void }) {
  const [y, setY] = useState(year() - (new Date().getMonth() < 4 ? 1 : 0));
  const [busy, setBusy] = useState(false);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Tax pack"
      description="One Excel file for your CPA: the tax summary and the transactions behind it, a Schedule C view of each business project, income and spending, net worth at the start and end of the year, the general ledger and reconciliation status."
      submitLabel="Download Excel"
      busy={busy}
      onSubmit={async () => {
        setBusy(true);
        try {
          const bytes = buildTaxPack(await collectPack(y));
          const blob = new Blob([bytes as BlobPart], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `Kane_Books_Tax_Pack_${y}.xlsx`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast.success("Tax pack downloaded");
          onClose();
        } catch (e) {
          toast.error("Could not build the tax pack", {
            description: e instanceof Error ? e.message : String(e),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Tax year">
        <Select value={String(y)} onChange={(v) => setY(Number(v))}>
          {[0, 1, 2, 3].map((i) => (
            <option key={i}>{year() - i}</option>
          ))}
        </Select>
      </Field>
    </FormDialog>
  );
}
