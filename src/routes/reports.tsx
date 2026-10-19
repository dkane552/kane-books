import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/shared";
import { ReportsPage, type ReportLink } from "@/components/app/reports";
import { defined, id, iso, text } from "@/lib/search";

export const Route = createFileRoute("/reports")({
  head: () => pageHead("Reports"),
  validateSearch: (s: Record<string, unknown>): ReportLink =>
    defined({
      report: text(s["report"]),
      account: id(s["account"]),
      from: iso(s["from"]),
      to: iso(s["to"]),
      asOf: iso(s["asOf"]),
      uncategorized: s["uncategorized"] === "1" || s["uncategorized"] === 1 ? "1" : undefined,
    }),
  component: ReportsRoute,
});
function ReportsRoute() {
  const link = Route.useSearch();
  // A new link (from the side panel) starts the report fresh.
  return <ReportsPage key={JSON.stringify(link)} link={link} />;
}
