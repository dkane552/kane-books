import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { refreshForTables } from "@/lib/data";

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  for (const key of ["payees", "audit_log", "home_summary", "gl_accounts", "v_bank_transactions"])
    qc.setQueryData(["db", key], []);
  return qc;
}
const stale = (qc: QueryClient) =>
  qc
    .getQueryCache()
    .getAll()
    .filter((q) => q.isStale())
    .map((q) => String(q.queryKey[1]))
    .sort();

describe("live refresh", () => {
  it("refreshes only the payee list when a payee changes", () => {
    const qc = client();
    expect(refreshForTables(qc, ["payees"])).toEqual(["payees"]);
    expect(stale(qc)).toEqual(["payees"]);
  });

  it("refreshes everything when money can move", () => {
    const qc = client();
    expect(refreshForTables(qc, ["payees", "ledger_lines"])).toBe("all");
    expect(stale(qc)).toEqual([
      "audit_log",
      "gl_accounts",
      "home_summary",
      "payees",
      "v_bank_transactions",
    ]);
  });
});
