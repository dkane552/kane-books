import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/shared";
import { ACCOUNT_TABS, AccountsPage } from "@/components/app/accounts";
import { defined, id } from "@/lib/search";

export const Route = createFileRoute("/accounts")({
  head: () => pageHead("Accounts"),
  validateSearch: (s: Record<string, unknown>): { tab?: string; account?: string } =>
    defined({
      tab: typeof s["tab"] === "string" && ACCOUNT_TABS.includes(s["tab"]) ? s["tab"] : undefined,
      account: id(s["account"]),
    }),
  component: AccountsRoute,
});
function AccountsRoute() {
  const { tab, account } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AccountsPage
      tab={tab ?? "Balances"}
      account={account}
      onTab={(t) => navigate({ search: { tab: t }, resetScroll: false })}
    />
  );
}
