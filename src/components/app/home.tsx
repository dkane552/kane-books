import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  CreditCard,
  Info,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingRows, Money, PageHeading, Panel, StatusPill } from "./shared";
import { PeekName, TileButton } from "./peek";
import { CashflowChart, NetWorthChart, SpendingBars } from "./charts";
import { useAuth } from "./auth";
import { useHome } from "@/lib/data";
import { firstName, fmtDate, fmtDateShort, fmtMonth, money, moneyChange, num } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/accounts";
import type { AttentionItem, HomeAccount } from "@/lib/types";

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Chicago",
    }).format(new Date()),
  );
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const TONE: Record<
  AttentionItem["tone"],
  { icon: typeof Info; cls: string; label: string; order: number }
> = {
  high: { icon: AlertCircle, cls: "text-destructive", label: "Now", order: 0 },
  medium: { icon: AlertTriangle, cls: "text-[var(--warn)]", label: "Soon", order: 1 },
  low: { icon: Info, cls: "text-muted-foreground", label: "When you can", order: 2 },
};

export function HomePage() {
  const { member } = useAuth();
  const navigate = useNavigate();
  const { data: h, isLoading, error } = useHome();
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  }).format(new Date());

  const series = h?.net_worth_series ?? [];
  const nwStart = series.length ? num(series[0]!.net_worth) : 0;
  const nwNow = num(h?.totals.net_worth);
  const spentPct =
    num(h?.budget.budgeted) > 0 ? num(h?.budget.spent_in_budget) / num(h?.budget.budgeted) : null;

  return (
    <>
      <PageHeading
        title={`${greeting()}, ${firstName(member?.full_name)}.`}
        eyebrow={date}
        subtitle="Where your money is, where it went, and what needs you."
      >
        <Button variant="outline" size="sm" asChild>
          <Link to="/reports">
            <ArrowUpRight />
            Reports
          </Link>
        </Button>
        <Button size="sm" asChild>
          <Link to="/transactions">Review transactions</Link>
        </Button>
      </PageHeading>

      {error && (
        <div className="mb-4 rounded-md bg-accent p-3 text-xs">
          The home screen could not load: {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className="metrics">
        <TileButton
          onClick={() => navigate({ to: "/reports", search: { report: "Net Worth" } })}
          title="Open the net worth statement"
        >
          <div className="metric-top">
            <span>Net worth</span>
            <TrendingUp />
          </div>
          <div className="metric-value">{h ? money(nwNow) : "..."}</div>
          <div className="metric-foot">
            <span>
              {series.length >= 12
                ? "Last 12 months"
                : series.length
                  ? `Since ${fmtMonth(series[0]!.month_end, true)}`
                  : ""}
            </span>
            <span className={`number ${nwNow - nwStart < 0 ? "text-destructive" : ""}`}>
              {h ? moneyChange(nwNow - nwStart) : ""}
            </span>
          </div>
        </TileButton>
        <TileButton onClick={() => navigate({ to: "/accounts" })} title="See every account">
          <div className="metric-top">
            <span>Cash</span>
            <Wallet />
          </div>
          <div className="metric-value">{h ? money(h.totals.cash) : "..."}</div>
          <div className="metric-foot">
            <span>Invested</span>
            <span className="number">{h ? money(h.totals.invested) : ""}</span>
          </div>
        </TileButton>
        <TileButton onClick={() => navigate({ to: "/accounts" })} title="See what you owe">
          <div className="metric-top">
            <span>Owed on cards</span>
            <CreditCard />
          </div>
          <div className="metric-value">{h ? money(h.totals.cards) : "..."}</div>
          <div className="metric-foot">
            <span>Loans</span>
            <span className="number">{h ? money(h.totals.loans) : ""}</span>
          </div>
        </TileButton>
        <TileButton onClick={() => navigate({ to: "/budget" })} title="Open this month's budget">
          <div className="metric-top">
            <span>Spent this month</span>
            <PiggyBank />
          </div>
          <div
            className={`metric-value ${spentPct !== null && spentPct > 1 ? "text-destructive" : ""}`}
          >
            {h ? money(h.month.spending) : "..."}
          </div>
          <div className="metric-foot">
            <span>{num(h?.budget.budgeted) > 0 ? "Budget" : "Income this month"}</span>
            <span className="number">
              {h ? money(num(h.budget.budgeted) > 0 ? h.budget.budgeted : h.month.income) : ""}
            </span>
          </div>
        </TileButton>
      </div>

      {isLoading ? (
        <LoadingRows rows={6} />
      ) : h ? (
        <div className="home-grid">
          <div className="home-left">
            <AttentionPanel items={h.attention} />
            <Panel
              title="Net worth"
              meta="last 12 months"
              action={
                <Button variant="link" size="sm" asChild>
                  <Link to="/reports" search={{ report: "Net Worth" }}>
                    Statement
                    <ArrowRight />
                  </Link>
                </Button>
              }
            >
              {series.some((p) => num(p.assets) || num(p.liabilities)) ? (
                <NetWorthChart data={series} />
              ) : (
                <EmptyState
                  compact
                  title="Nothing to chart yet"
                  description="Add opening balances for your accounts (Transactions, New entry, Opening balance) and net worth shows here."
                />
              )}
            </Panel>
            <Panel
              title="Income and spending"
              meta="last 12 months"
              action={
                <Button variant="link" size="sm" asChild>
                  <Link to="/reports" search={{ report: "By Month" }}>
                    By month
                    <ArrowRight />
                  </Link>
                </Button>
              }
            >
              <CashflowChart
                data={h.cashflow}
                onMonth={(m) => navigate({ to: "/budget", search: { month: m.slice(0, 7) } })}
              />
            </Panel>
          </div>
          <div className="home-right">
            <AccountsPanel accounts={h.accounts} />
            <Panel
              title="Spending this month"
              meta={money(h.month.spending)}
              action={
                <Button variant="link" size="sm" asChild>
                  <Link to="/budget">
                    Budget
                    <ArrowRight />
                  </Link>
                </Button>
              }
            >
              {h.spending_by_group.length ? (
                <SpendingBars
                  data={h.spending_by_group.map((g) => ({ label: g.group, amount: num(g.amount) }))}
                  onPick={() => navigate({ to: "/budget" })}
                />
              ) : (
                <EmptyState compact title="Nothing spent yet this month" />
              )}
              <div className="flex justify-between border-t px-5 py-2 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                <span>Last month</span>
                <span className="number">
                  {money(h.month.last_spending)} spent, {money(h.month.last_income)} in
                </span>
              </div>
            </Panel>
            <Panel
              title="Coming up"
              meta="next 14 days"
              action={
                <Button variant="link" size="sm" asChild>
                  <Link to="/recurring">
                    All bills
                    <ArrowRight />
                  </Link>
                </Button>
              }
            >
              {h.upcoming.length ? (
                <ul className="divide-y text-xs">
                  {h.upcoming.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 px-[18px] py-2">
                      <span className="w-14 text-muted-foreground">
                        {fmtDateShort(u.next_expected)}
                      </span>
                      <span className="flex-1">
                        {u.name}
                        {u.state === "late" && (
                          <span className="ml-2">
                            <StatusPill tone="denied">Late</StatusPill>
                          </span>
                        )}
                      </span>
                      <Money value={u.is_income ? num(u.amount) : -num(u.amount)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  title={
                    num(h.recurring.count)
                      ? "Nothing due in the next two weeks"
                      : "No recurring bills yet"
                  }
                  {...(num(h.recurring.count)
                    ? {}
                    : {
                        description:
                          "Recurring finds them in your bank activity once a few months have come in.",
                      })}
                />
              )}
              {num(h.recurring.count) > 0 && (
                <div className="flex justify-between border-t px-5 py-2 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                  <span>Bills a month, on average</span>
                  <span className="number">{money(h.recurring.monthly_bills)}</span>
                </div>
              )}
            </Panel>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const navigate = useNavigate();
  const sorted = [...items].sort((a, b) => TONE[a.tone].order - TONE[b.tone].order);
  return (
    <Panel title="Needs attention" meta={items.length}>
      {sorted.length === 0 ? (
        <EmptyState
          compact
          icon={CircleCheck}
          title="Nothing needs you right now."
          description="The bank feed, budgets, bills, reconciliations and backups are all in order."
        />
      ) : (
        <ul className="divide-y">
          {sorted.map((it, i) => {
            const t = TONE[it.tone];
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => navigate({ href: it.link })}
                  className="flex w-full items-start gap-3 px-[18px] py-2.5 text-left text-xs hover:bg-muted/60"
                >
                  <t.icon className={`mt-0.5 size-4 shrink-0 ${t.cls}`} aria-hidden />
                  <span className="flex-1">
                    <span className="font-medium">{it.title}</span>
                    <span className="mt-0.5 block text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                      {it.detail}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-[length:calc(10px*var(--ts,1))] font-medium ${t.cls}`}
                  >
                    {t.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function AccountsPanel({ accounts }: { accounts: HomeAccount[] }) {
  const own = accounts.filter((a) => a.classification === "Asset");
  const owe = accounts.filter((a) => a.classification === "Liability");
  const block = (title: string, list: HomeAccount[]) =>
    list.length > 0 && (
      <>
        <li className="bg-muted px-[18px] py-1.5 text-[length:calc(10px*var(--ts,1))] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </li>
        {list.map((a) => {
          const diff =
            a.bank_balance !== null
              ? Math.round((num(a.bank_balance) - num(a.balance)) * 100) / 100
              : 0;
          return (
            <li key={a.id} className="flex items-center gap-3 px-[18px] py-2 text-xs">
              <span className="min-w-0 flex-1">
                <PeekName target={{ kind: "gl", id: a.id }} title="See this account's activity">
                  <span className="block truncate">{a.name}</span>
                </PeekName>
                <span className="block text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                  {TYPE_LABEL[a.type]}
                  {a.for_review > 0 && ` · ${a.for_review} to review`}
                  {diff !== 0 && ` · bank says ${money(a.bank_balance)}`}
                </span>
              </span>
              <Money value={a.balance} />
            </li>
          );
        })}
      </>
    );
  return (
    <Panel
      title="Accounts"
      meta={accounts.length}
      action={
        <Button variant="link" size="sm" asChild>
          <Link to="/accounts">
            All
            <ArrowRight />
          </Link>
        </Button>
      }
    >
      {accounts.length ? (
        <ul className="divide-y">
          {block("What you own", own)}
          {block("What you owe", owe)}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={Landmark}
          title="No accounts yet"
          description="Link your bank and card accounts in Transactions, Accounts and rules."
        />
      )}
      {accounts.some((a) => a.last_synced_at) && (
        <div className="border-t px-5 py-2 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
          Bank feed last read{" "}
          {fmtDate(
            accounts
              .map((a) => a.last_synced_at ?? "")
              .sort()
              .at(-1)!
              .slice(0, 10),
          )}
        </div>
      )}
    </Panel>
  );
}
