import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/shared";
import { SettingsPage } from "@/components/app/settings";
export const Route = createFileRoute("/settings")({
  head: () => pageHead("Settings"),
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s["tab"] === "string" ? { tab: s["tab"] } : {},
  component: () => <SettingsPage />,
});
