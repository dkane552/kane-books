// Budget: a monthly amount per category (the usual amount, or a different one for a single month), against
// what actually came in and went out. Schema: budget_amounts and report_budget() in supabase/4_personal.sql.
import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  LoadingRows,
  LocalTabs,
  Money,
  PageHeading,
  Panel,
  confirmAction,
} from "./shared";
import { PeekName } from "./peek";
import { useBudgetAmounts, useDb, useGlAccounts, useReport } from "@/lib/data";
import { supabase, unwrap } from "@/lib/supabase";
import { addMonths, fmtMonth, money, monthEnd, num, todayISO } from "@/lib/format";
import { glLabel } from "@/lib/accounts";
import type { BudgetRow, BudgetYearRow } from "@/lib/types";

const VIEWS = ["Month", "Year"];

export function BudgetPage({ month: initial }: { month?: string | undefined }) {
  const navigate = useNavigate();
  const month = /^\d{4}-\d{2}$/.test(initial ?? "")
    ? `${initial}-01`
    : `${todayISO().slice(0, 7)}-01`;
  const setMonth = (m: string) =>
    navigate({ to: "/budget", search: { month: m.slice(0, 7) }, replace: true });
  const [view, setView] = useState("Month");
  return (
    <>
      <PageHeading
        title="Budget"
        eyebrow="PLAN AND TRACK"
        subtitle="What you meant to spend, next to what you did."
      >
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">
            {view === "Year" ? month.slice(0, 4) : fmtMonth(month)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </PageHeading>
      <Panel>
        <div className="px-3">
          <LocalTabs options={VIEWS} value={view} onChange={setView} />
        </div>
        {view === "Year" ? (
          <YearView year={Number(month.slice(0, 4))} />
        ) : (
          <MonthView month={month} />
        )}
      </Panel>
    </>
  );
}

function MonthView({ month }: { month: string }) {
  const q = useReport<BudgetRow>("report_budget", { p_month: month });
  const { data: amounts } = useBudgetAmounts();
  const { data: gl } = useGlAccounts();
  const db = useDb();
  const [adding, setAdding] = useState("");
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const spending = rows.filter((r) => r.section === "Spending");
  const income = rows.filter((r) => r.section === "Income");
  const budgeted = spending.reduce((s, r) => s + num(r.budget), 0);
  const spent = spending.reduce((s, r) => s + num(r.actual), 0);
  const spentInBudget = spending
    .filter((r) => num(r.budget) > 0)
    .reduce((s, r) => s + num(r.actual), 0);
  const incomeBudget = income.reduce((s, r) => s + num(r.budget), 0);
  const received = income.reduce((s, r) => s + num(r.actual), 0);
  const isPast = monthEnd(month) < todayISO();
  const missing = (gl ?? []).filter(
    (a) =>
      a.is_active &&
      (a.account_type === "Expense" || a.account_type === "Income") &&
      !rows.some((r) => r.gl_account_id === a.id),
  );

  /** Save a budget: for every month (month null) or this month only. Blank removes it. */
  async function setBudget(accountId: string, value: string, onlyThisMonth: boolean) {
    const m = onlyThisMonth ? month : null;
    const existing = (amounts ?? []).find(
      (b) => b.gl_account_id === accountId && (b.month ?? null) === m,
    );
    await db.batch(async () => {
      if (value.trim() === "") {
        if (existing) unwrap(await supabase.from("budget_amounts").delete().eq("id", existing.id));
        return;
      }
      const amount = Math.max(0, Number(value) || 0);
      if (existing)
        unwrap(await supabase.from("budget_amounts").update({ amount }).eq("id", existing.id));
      else
        unwrap(
          await supabase
            .from("budget_amounts")
            .insert({ gl_account_id: accountId, month: m, amount }),
        );
    });
  }

  async function fillFromAverage() {
    const todo = rows.filter((r) => num(r.budget) === 0 && num(r.avg_3mo) > 0);
    if (!todo.length) return void toast("Every category with recent activity already has a budget");
    if (
      !confirmAction(
        `Set ${todo.length} budgets to their 3-month average (rounded up to $5), for every month?`,
      )
    )
      return;
    await db.batch(async () =>
      unwrap(
        await supabase.from("budget_amounts").insert(
          todo.map((r) => ({
            gl_account_id: r.gl_account_id,
            month: null,
            amount: Math.ceil(num(r.avg_3mo) / 5) * 5,
          })),
        ),
      ),
    );
    toast.success(`${todo.length} budgets set`);
  }

  const groups = useMemo(() => {
    const out: { section: string; group: string; rows: BudgetRow[] }[] = [];
    for (const r of rows) {
      let g = out.find((x) => x.section === r.section && x.group === r.category_group);
      if (!g) out.push((g = { section: r.section, group: r.category_group, rows: [] }));
      g.rows.push(r);
    }
    return out;
  }, [rows]);

  return (
    <>
      <div className="metrics p-4">
        <Tile
          title="Budgeted spending"
          value={budgeted}
          foot="Spent on budgeted"
          footValue={spentInBudget}
        />
        <Tile
          title="Spent"
          value={spent}
          foot={isPast ? "Whole month" : "So far"}
          footText=""
          bad={budgeted > 0 && spent > budgeted}
        />
        <Tile
          title="Left to spend"
          value={budgeted - spentInBudget}
          foot="Unbudgeted spending"
          footValue={spent - spentInBudget}
          bad={budgeted - spentInBudget < 0}
        />
        <Tile title="Income" value={received} foot="Expected" footValue={incomeBudget} />
      </div>
      <div className="toolbar">
        <span className="text-xs text-muted-foreground">
          Type a budget and leave the box to save it. Budgets repeat every month; click "monthly"
          beside one to change only this month.
        </span>
        <div className="toolbar-end ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={fillFromAverage} disabled={db.pending}>
            <Wand2 />
            Fill from 3-month average
          </Button>
          <select
            aria-label="Add a category"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">Add a category...</option>
            {missing.map((a) => (
              <option key={a.id} value={a.id}>
                {glLabel(a)}
              </option>
            ))}
          </select>
          {adding && (
            <Button
              size="sm"
              onClick={async () => {
                await setBudget(adding, "0", false);
                setAdding("");
              }}
            >
              <Plus />
              Add
            </Button>
          )}
        </div>
      </div>
      {q.isLoading ? (
        <LoadingRows />
      ) : !rows.length ? (
        <EmptyState
          compact
          title="No budgets or activity this month"
          description="Add a category above, or fill budgets from your recent spending once a few months are in the books."
        />
      ) : (
        <div className="data-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="numeric">Budget</th>
                <th className="numeric">{isPast ? "Actual" : "So far"}</th>
                <th className="numeric">Left</th>
                <th className="w-40" />
                <th className="numeric">3-month avg</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const b = g.rows.reduce((s, r) => s + num(r.budget), 0);
                const a = g.rows.reduce((s, r) => s + num(r.actual), 0);
                const firstOfSection = gi === 0 || groups[gi - 1]!.section !== g.section;
                return (
                  <Fragment key={`${g.section}-${g.group}`}>
                    {firstOfSection && (
                      <tr>
                        <td
                          colSpan={6}
                          className="pt-4 text-[length:calc(11px*var(--ts,1))] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {g.section}
                        </td>
                      </tr>
                    )}
                    <tr className="bg-muted">
                      <td className="font-semibold">{g.group}</td>
                      <td className="text-right font-semibold">
                        <Money value={b} blankZero />
                      </td>
                      <td className="text-right font-semibold">
                        <Money value={a} />
                      </td>
                      <td className="text-right font-semibold">
                        {b > 0 && (
                          <Money value={g.section === "Spending" ? b - a : Math.max(0, b - a)} />
                        )}
                      </td>
                      <td>
                        {b > 0 && <Progress value={a} of={b} income={g.section !== "Spending"} />}
                      </td>
                      <td />
                    </tr>
                    {g.rows.map((r) => (
                      <BudgetLine key={r.gl_account_id} row={r} month={month} onSave={setBudget} />
                    ))}
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

function BudgetLine({
  row: r,
  month,
  onSave,
}: {
  row: BudgetRow;
  month: string;
  onSave: (id: string, v: string, only: boolean) => Promise<void>;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [only, setOnly] = useState(r.budget_is_override);
  const budget = num(r.budget);
  const actual = num(r.actual);
  const shown = value ?? (budget ? String(budget) : "");
  const save = async () => {
    if (value === null) return;
    const v = value;
    setValue(null);
    if (v === (budget ? String(budget) : "")) return;
    await onSave(r.gl_account_id, v, only);
  };
  return (
    <tr>
      <td className="pl-6">
        <PeekName target={{ kind: "gl", id: r.gl_account_id, from: month, to: monthEnd(month) }}>
          {r.account_name}
        </PeekName>
      </td>
      <td className="w-40 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            className={`rounded px-1 text-[length:calc(9px*var(--ts,1))] uppercase ${only ? "bg-accent text-primary" : "text-muted-foreground"}`}
            title={
              only
                ? "This month only. Click to use the usual amount."
                : "Every month. Click to change only this month."
            }
            onClick={async () => {
              if (only && r.budget_is_override) await onSave(r.gl_account_id, "", true);
              setOnly(!only);
            }}
          >
            {only ? fmtMonth(month, true) : "monthly"}
          </button>
          <Input
            className="h-7 w-24 text-right"
            type="number"
            step="1"
            min="0"
            value={shown}
            placeholder="0"
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label={`Budget for ${r.account_name}`}
          />
        </div>
      </td>
      <td className="text-right">
        <Money value={actual} blankZero />
      </td>
      <td
        className={`text-right ${budget > 0 && actual > budget && r.section === "Spending" ? "text-destructive" : ""}`}
      >
        {budget > 0 && (
          <Money
            value={r.section === "Spending" ? budget - actual : Math.max(0, budget - actual)}
          />
        )}
      </td>
      <td>
        {budget > 0 && <Progress value={actual} of={budget} income={r.section !== "Spending"} />}
      </td>
      <td className="text-right text-muted-foreground">
        <Money value={r.avg_3mo} blankZero />
      </td>
    </tr>
  );
}

function Progress({ value, of, income = false }: { value: number; of: number; income?: boolean }) {
  const pct = of > 0 ? value / of : 0;
  const over = !income && pct > 1;
  return (
    <div className="flex items-center gap-2" title={`${Math.round(pct * 100)}%`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
        <div
          className="h-full rounded"
          style={{
            width: `${Math.min(100, pct * 100)}%`,
            background: over
              ? "var(--destructive)"
              : income
                ? "var(--chart-income)"
                : "var(--chart-net)",
          }}
        />
      </div>
      <span
        className={`number w-9 text-right text-[length:calc(10px*var(--ts,1))] ${over ? "text-destructive" : "text-muted-foreground"}`}
      >
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

function Tile({
  title,
  value,
  foot,
  footValue,
  footText,
  bad = false,
}: {
  title: string;
  value: number;
  foot: string;
  footValue?: number;
  footText?: string;
  bad?: boolean;
}) {
  return (
    <section className="panel metric">
      <div className="metric-top">
        <span>{title}</span>
      </div>
      <div className={`metric-value ${bad ? "text-destructive" : ""}`}>{money(value)}</div>
      <div className="metric-foot">
        <span>{foot}</span>
        <span className="number">
          {footText ?? (footValue !== undefined ? money(footValue) : "")}
        </span>
      </div>
    </section>
  );
}

function YearView({ year }: { year: number }) {
  const q = useReport<BudgetYearRow>("report_budget_year", { p_year: year });
  const { data: gl } = useGlAccounts();
  const months = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}-01`,
  );
  const ids = [...new Set((q.data ?? []).map((r) => r.gl_account_id))];
  const accts = (gl ?? [])
    .filter((a) => ids.includes(a.id))
    .sort((a, b) =>
      a.account_type === b.account_type
        ? `${a.category_group}${a.number}${a.name}`.localeCompare(
            `${b.category_group}${b.number}${b.name}`,
          )
        : a.account_type === "Income"
          ? -1
          : 1,
    );
  const cell = (id: string, m: string) =>
    q.data?.find((r) => r.gl_account_id === id && r.month === m);
  const today = todayISO();
  if (q.isLoading) return <LoadingRows />;
  if (!accts.length) return <EmptyState compact title={`No budgets or activity in ${year}`} />;
  return (
    <div className="data-scroll">
      <table className="data-table text-[length:calc(11px*var(--ts,1))]">
        <thead>
          <tr>
            <th>Category</th>
            {months.map((m) => (
              <th key={m} className="numeric">
                {fmtMonth(m, true)}
              </th>
            ))}
            <th className="numeric">Year</th>
          </tr>
        </thead>
        <tbody>
          {accts.map((a) => {
            let tb = 0;
            let ta = 0;
            return (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{a.name}</td>
                {months.map((m) => {
                  const c = cell(a.id, m);
                  const b = num(c?.budget);
                  const act = num(c?.actual);
                  tb += b;
                  ta += act;
                  const over = a.account_type === "Expense" && b > 0 && act > b;
                  return (
                    <td
                      key={m}
                      className={`text-right ${m > today ? "text-muted-foreground" : ""}`}
                    >
                      <div className={`number ${over ? "text-destructive" : ""}`}>
                        {act ? money(act).replace(".00", "") : ""}
                      </div>
                      {b > 0 && (
                        <div className="number text-[length:calc(9px*var(--ts,1))] text-muted-foreground">
                          of {money(b).replace(".00", "")}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="text-right font-medium">
                  <div className="number">{money(ta).replace(".00", "")}</div>
                  {tb > 0 && (
                    <div className="number text-[length:calc(9px*var(--ts,1))] text-muted-foreground">
                      of {money(tb).replace(".00", "")}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
