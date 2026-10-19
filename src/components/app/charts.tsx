// Money charts (Recharts). Colors: --chart-income (green), --chart-spending (amber), --chart-net (blue) in
// styles.css, validated together for color-blind readers. The amber is light, so charts carry legends,
// value labels or a table next to them.
import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMonth, money, num } from "@/lib/format";
import type { Num } from "@/lib/types";

export const CHART = {
  income: "var(--chart-income)",
  spending: "var(--chart-spending)",
  net: "var(--chart-net)",
  grid: "var(--border)",
  muted: "var(--muted-foreground)",
};
const axisTick = { fontSize: 10, fill: CHART.muted };

export function moneyCompact(v: number) {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** True on phone-width screens. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function Swatch({ color, line = false }: { color: string; line?: boolean }) {
  return line ? (
    <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: color }} aria-hidden />
  ) : (
    <span
      className="inline-block size-2.5 rounded-[3px]"
      style={{ background: color }}
      aria-hidden
    />
  );
}

export function Legend({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div className="flex flex-wrap gap-4 px-5 pb-3 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
      {items.map(([label, color, line]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <Swatch color={color} line={!!line} />
          {label}
        </span>
      ))}
    </div>
  );
}

function TipBox({ title, rows }: { title: ReactNode; rows: [ReactNode, number, string?][] }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-[length:calc(11px*var(--ts,1))] shadow-sm">
      <div className="mb-1 font-medium">{title}</div>
      {rows.map(([label, v, color], i) => (
        <div key={i} className="flex items-center justify-between gap-6">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            {color && <Swatch color={color} />}
            {label}
          </span>
          <span className="font-mono">{money(v)}</span>
        </div>
      ))}
    </div>
  );
}

/** Income and spending by month, with what was saved as a line. Clicking a month calls onMonth. */
export function CashflowChart({
  data,
  onMonth,
  height = 240,
}: {
  data: { month: string; income: Num; spending: Num }[];
  onMonth?: (month: string) => void;
  height?: number;
}) {
  const rows = data.map((d) => ({
    month: d.month,
    income: num(d.income),
    spending: num(d.spending),
    saved: num(d.income) - num(d.spending),
  }));
  return (
    <>
      <div style={{ height }} className="px-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 10, right: 12, bottom: 0, left: 4 }}
            onClick={(e) => {
              const m = (e as { activeLabel?: string } | null)?.activeLabel;
              if (m && onMonth) onMonth(m);
            }}
          >
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => fmtMonth(m, true)}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => moneyCompact(v)}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              content={({ active, payload }) => {
                const p = active
                  ? (payload?.[0]?.payload as (typeof rows)[number] | undefined)
                  : undefined;
                return p ? (
                  <TipBox
                    title={fmtMonth(p.month)}
                    rows={[
                      ["Income", p.income, CHART.income],
                      ["Spending", p.spending, CHART.spending],
                      ["Saved", p.saved, CHART.net],
                    ]}
                  />
                ) : null;
              }}
            />
            {[
              <Bar
                key="i"
                dataKey="income"
                fill={CHART.income}
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                cursor={onMonth ? "pointer" : undefined}
              />,
              <Bar
                key="s"
                dataKey="spending"
                fill={CHART.spending}
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                cursor={onMonth ? "pointer" : undefined}
              />,
              <Line
                key="n"
                dataKey="saved"
                stroke={CHART.net}
                strokeWidth={2}
                dot={{ r: 2.5 }}
                type="monotone"
              />,
            ]}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          ["Income", CHART.income],
          ["Spending", CHART.spending],
          ["Saved (income less spending)", CHART.net, true],
        ]}
      />
    </>
  );
}

/** Net worth at each month end, with what you own and owe in the tooltip. */
export function NetWorthChart({
  data,
  height = 220,
}: {
  data: {
    month_end: string;
    net_worth: Num;
    assets: Num;
    liabilities: Num;
    cash: Num;
    invested: Num;
  }[];
  height?: number;
}) {
  // Months before anything was in the books are left off.
  const first = data.findIndex((d) => num(d.assets) !== 0 || num(d.liabilities) !== 0);
  const rows = (first < 0 ? data : data.slice(first)).map((d) => ({
    month: d.month_end,
    net: num(d.net_worth),
    assets: num(d.assets),
    liabilities: num(d.liabilities),
    cash: num(d.cash),
    invested: num(d.invested),
  }));
  return (
    <div style={{ height }} className="px-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-net)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-net)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => fmtMonth(m, true)}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => moneyCompact(v)}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={({ active, payload }) => {
              const p = active
                ? (payload?.[0]?.payload as (typeof rows)[number] | undefined)
                : undefined;
              return p ? (
                <TipBox
                  title={`End of ${fmtMonth(p.month)}`}
                  rows={[
                    ["Net worth", p.net, CHART.net],
                    ["Cash", p.cash],
                    ["Invested", p.invested],
                    ["All you own", p.assets],
                    ["All you owe", p.liabilities],
                  ]}
                />
              ) : null;
            }}
          />
          <Area
            dataKey="net"
            stroke={CHART.net}
            strokeWidth={2}
            fill="url(#nwFill)"
            type="monotone"
            dot={{ r: 2.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars with the amount at the end of each, for spending by group or category. */
export function SpendingBars({
  data,
  onPick,
  color = CHART.spending,
}: {
  data: { label: string; amount: number; key?: string }[];
  onPick?: (key: string) => void;
  color?: string;
}) {
  const narrow = useNarrow();
  const rows = data.filter((d) => d.amount !== 0);
  return (
    <div style={{ height: Math.max(80, rows.length * 30 + 20) }} className="px-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={narrow ? 92 : 132}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => {
              const p = active
                ? (payload?.[0]?.payload as (typeof rows)[number] | undefined)
                : undefined;
              return p ? <TipBox title={p.label} rows={[["Amount", p.amount, color]]} /> : null;
            }}
          />
          <Bar
            dataKey="amount"
            fill={color}
            radius={[0, 3, 3, 0]}
            maxBarSize={18}
            cursor={onPick ? "pointer" : undefined}
            onClick={(d) => {
              const k =
                (d as unknown as { key?: string; label?: string }).key ??
                (d as unknown as { label?: string }).label;
              if (k && onPick) onPick(k);
            }}
          >
            <LabelList
              dataKey="amount"
              position="right"
              formatter={(v: unknown) => moneyCompact(Number(v))}
              style={{
                fontSize: 10,
                fill: "var(--muted-foreground)",
                fontFamily: "var(--font-mono)",
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
