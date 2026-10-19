// Reading bank and card statement exports (CSV) for the bank feed upload.

/** Splits CSV text into rows of cells. Handles quoted cells, doubled quotes, commas and line breaks in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "$1,234.56", "(12.00)", "-12", "12.00 CR" to a number; blank or unreadable to null. */
export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\s*(CR)$/i.test(s)) s = s.replace(/\s*CR$/i, "");
  else if (/\s*(DR)$/i.test(s)) {
    sign *= -1;
    s = s.replace(/\s*DR$/i, "");
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    sign *= -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  return Math.round(sign * Number(s) * 100) / 100;
}

/** "10/05/2026", "10/5/26", "2026-10-05", "Oct 5, 2026" to "2026-10-05"; unreadable to null. */
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    let y = +m[3]!;
    if (y < 100) y += 2000;
    return iso(y, +m[1]!, +m[2]!);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface StatementMapping {
  date: number;
  description: number;
  /** One signed amount column, or -1 when the file has separate money out / money in columns. */
  amount: number;
  debit: number;
  credit: number;
  /** Charges are positive in the file (common for card exports): flip the signs. */
  flip: boolean;
}

const find = (header: string[], ...names: RegExp[]) => {
  for (const n of names) {
    const i = header.findIndex((h) => n.test(h.trim().toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
};

/** Best guess at which columns hold what, from the header row. */
export function guessMapping(header: string[]): StatementMapping {
  const amount = find(header, /^amount$/, /amount/, /^net/);
  const debit = find(header, /withdraw/, /debit/, /money out/, /^charges?$/, /payments? out/);
  const credit = find(header, /deposit/, /credit/, /money in/, /payments? in/);
  return {
    date: find(header, /^post(ing|ed)? date$/, /^date$/, /date/),
    description: find(header, /^description$/, /description/, /memo|payee|merchant|details|name/),
    amount: amount >= 0 && !(debit >= 0 && credit >= 0) ? amount : -1,
    debit,
    credit,
    flip: false,
  };
}

export interface StatementRow {
  txn_date: string;
  amount: number;
  description: string;
}

/** Rows ready for bank_import_statement (money in positive, money out negative) plus rows it could not read. */
export function toStatementRows(
  rows: string[][],
  map: StatementMapping,
): { rows: StatementRow[]; skipped: number } {
  const out: StatementRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const date = parseDate(r[map.date]);
    let amount: number | null;
    if (map.amount >= 0) amount = parseAmount(r[map.amount]);
    else {
      const out_ = parseAmount(r[map.debit]);
      const in_ = parseAmount(r[map.credit]);
      amount = out_ == null && in_ == null ? null : (in_ ?? 0) - Math.abs(out_ ?? 0);
    }
    if (amount != null && map.flip) amount = -amount;
    if (!date || amount == null || amount === 0) {
      skipped++;
      continue;
    }
    out.push({
      txn_date: date,
      amount,
      description: (map.description >= 0 ? (r[map.description] ?? "") : "").trim(),
    });
  }
  return { rows: out, skipped };
}
