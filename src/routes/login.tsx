import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/components/app/login";
import { pageHead } from "@/components/app/shared";
export const Route = createFileRoute("/login")({
  head: () => pageHead("Sign in"),
  component: () => <LoginPage />,
});
