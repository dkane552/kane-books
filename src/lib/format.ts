import type { Num } from "./types";

export function num(v: Num | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(v: Num | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** $1,234.56; negative shows as -$1,234.56 */
export function money(v: Num | undefined): string {
  return usd.format(num(v));
}
export function money0(v: Num | undefined): string {
  return usd0.format(num(v));
}
/** Blank for zero, used in dense grids. */
export function moneyOrBlank(v: Num | undefined): string {
  const n = num(v);
  return n === 0 ? "" : usd.format(n);
}

/** 0.2239 -> 22.39% */
export function pct(v: Num | undefined, digits = 2): string {
  const n = numOrNull(v);
  if (n === null) return "";
  return `${(n * 100).toFixed(digits)}%`;
}

export function isNegative(v: Num | undefined) {
  return num(v) < 0;
}

/** Parse a YYYY-MM-DD date as a local date (avoids the UTC off-by-one). */
export function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = parseDate(iso) ?? new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Same day n months later (Jan 31 + 1 month = Feb 28). */
export function addMonths(iso: string, months: number): string {
  const d = parseDate(iso) ?? new Date();
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISODate(d);
}

export function daysBetween(a: string, b: string): number {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const shortNoYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const weekdayDate = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function fmtDate(d: string | null | undefined): string {
  const x = parseDate(d);
  return x ? shortDate.format(x) : "";
}
export function fmtDateShort(d: string | null | undefined): string {
  const x = parseDate(d);
  return x ? shortNoYear.format(x) : "";
}
export function fmtWeekday(d: string | null | undefined): string {
  const x = parseDate(d);
  return x ? weekdayDate.format(x) : "";
}

export function timeAgo(ts: string | null | undefined): string {
  if (!ts) return "";
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return shortDate.format(new Date(ts));
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function firstName(nameOrEmail: string | null | undefined): string {
  if (!nameOrEmail) return "Someone";
  if (nameOrEmail.includes("@")) return nameOrEmail.split("@")[0] ?? nameOrEmail;
  return nameOrEmail.split(" ")[0] ?? nameOrEmail;
}

/** "2026-10-01" -> "October 2026" */
export function fmtMonth(d: string | null | undefined, short = false): string {
  const x = parseDate(d);
  return x
    ? x.toLocaleDateString("en-US", {
        month: short ? "short" : "long",
        year: short ? "2-digit" : "numeric",
      })
    : "";
}

/** First day of the month a date falls in. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Last day of the month a date falls in. */
export function monthEnd(iso: string): string {
  const d = parseDate(monthStart(iso))!;
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Whole dollars with a sign for changes: +$120, -$45. */
export function moneyChange(v: Num | undefined): string {
  const n = num(v);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${money0(Math.abs(n))}`;
}
