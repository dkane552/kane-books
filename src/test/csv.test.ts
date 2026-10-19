import { describe, expect, it } from "vitest";
import { guessMapping, parseAmount, parseCsv, parseDate, toStatementRows } from "@/lib/csv";

describe("statement CSV", () => {
  it("reads quoted cells, commas and line breaks", () => {
    expect(parseCsv('Date,Description,Amount\r\n10/05/2026,"ACME, INC ""HQ""",-12.50\n\n')).toEqual(
      [
        ["Date", "Description", "Amount"],
        ["10/05/2026", 'ACME, INC "HQ"', "-12.50"],
      ],
    );
  });

  it("reads amounts in bank formats", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("-7")).toBe(-7);
    expect(parseAmount("50.00 DR")).toBe(-50);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("reads dates in bank formats", () => {
    expect(parseDate("10/5/26")).toBe("2026-10-05");
    expect(parseDate("2026-10-05")).toBe("2026-10-05");
    expect(parseDate("13/45/2026")).toBeNull();
  });

  it("handles a Chase card export (one signed amount column)", () => {
    const [h, ...rows] = parseCsv(
      "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
        "10/14/2026,10/15/2026,MENARDS JOLIET IL,Home,Sale,-52.10,\n" +
        "10/16/2026,10/16/2026,Payment Thank You,,Payment,500.00,\n",
    );
    const map = guessMapping(h!);
    expect(map.date).toBe(1);
    expect(map.amount).toBe(5);
    expect(toStatementRows(rows, map).rows).toEqual([
      { txn_date: "2026-10-15", amount: -52.1, description: "MENARDS JOLIET IL" },
      { txn_date: "2026-10-16", amount: 500, description: "Payment Thank You" },
    ]);
  });

  it("handles a checking export with withdrawal and deposit columns", () => {
    const [h, ...rows] = parseCsv(
      "Date,Description,Withdrawals,Deposits,Balance\n" +
        '10/01/2026,CHECK 7401,"1,200.00",,10000\n' +
        "10/02/2026,DEPOSIT,,250000.00,260000\n" +
        "10/03/2026,BEGINNING BALANCE,,,260000\n",
    );
    const map = guessMapping(h!);
    expect(map.amount).toBe(-1);
    expect(toStatementRows(rows, map)).toEqual({
      rows: [
        { txn_date: "2026-10-01", amount: -1200, description: "CHECK 7401" },
        { txn_date: "2026-10-02", amount: 250000, description: "DEPOSIT" },
      ],
      skipped: 1,
    });
  });

  it("flips signs when charges are positive in the file", () => {
    const map = { ...guessMapping(["Date", "Description", "Amount"]), flip: true };
    expect(toStatementRows([["10/01/2026", "SHELL", "30.00"]], map).rows[0]!.amount).toBe(-30);
  });
});
