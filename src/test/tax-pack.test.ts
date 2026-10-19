import { describe, expect, it } from "vitest";
import { buildTaxPack } from "@/lib/tax-pack";

const zipNames = (bytes: Uint8Array) => {
  const text = new TextDecoder("latin1").decode(bytes);
  return [...text.matchAll(/xl\/worksheets\/sheet\d+\.xml/g)].map((m) => m[0]);
};

describe("tax pack", () => {
  it("builds a workbook with every sheet, even for an empty year", () => {
    const bytes = buildTaxPack({
      owner: "Derek Kane",
      year: 2026,
      start: "2026-01-01",
      end: "2026-12-31",
      closedThrough: null,
      generatedAt: "generated now",
      exceptions: 0,
      tb: [],
      pl: [],
      bsStart: [],
      bsEnd: [],
      gl: [],
      tax: [],
      taxDetail: [],
      businesses: [],
      recon: [],
    });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new Set(zipNames(bytes)).size).toBe(8);
  });

  it("totals tax lines and business projects", () => {
    const bytes = buildTaxPack({
      owner: "Derek Kane",
      year: 2026,
      start: "2026-01-01",
      end: "2026-12-31",
      closedThrough: "2026-12-31",
      generatedAt: "generated now",
      exceptions: 0,
      tb: [
        {
          gl_account_id: "a",
          account_number: "1000",
          account_name: "Checking",
          account_type: "Bank",
          debit: 10,
          credit: 0,
        },
      ],
      pl: [
        {
          section: "Income",
          category_group: "Income",
          gl_account_id: "p",
          account_number: "4000",
          account_name: "Paychecks",
          amount: 100,
        },
      ],
      bsStart: [],
      bsEnd: [
        {
          section: "What you own",
          account_type: "Bank",
          gl_account_id: "a",
          account_number: "1000",
          account_name: "Checking",
          balance: 10,
        },
      ],
      gl: [],
      tax: [{ tax_line: "Wages (W-2)", amount: 100, lines: 1 }],
      taxDetail: [
        {
          tax_line: "Wages (W-2)",
          txn_date: "2026-02-01",
          account_name: "Paychecks",
          party_name: "Spyglass Inc",
          project_name: null,
          memo: null,
          amount: 100,
          source_id: "e",
        },
      ],
      businesses: [
        {
          name: "Venture City",
          rows: [
            {
              section: "Income",
              category_group: "Income",
              gl_account_id: "s",
              account_number: "4200",
              account_name: "Side income",
              amount: 50,
            },
          ],
        },
      ],
      recon: [
        {
          account_name: "Checking",
          account_type: "Bank",
          last_reconciled: "2026-12-31",
          statement_balance: 10,
        },
      ],
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("Venture City");
    expect(text).toContain("Wages (W-2)");
  });
});
