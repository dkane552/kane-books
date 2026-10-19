import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Home,
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  Repeat,
  FolderKanban,
  ChartNoAxesCombined,
  Settings,
  Accessibility,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ChevronDown,
  Search,
  LogOut,
  Users,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "./auth";
import { PeekProvider, usePeek } from "./peek";
import { BrandLogo } from "./brand";
import { EntryDialog, ValueDialog } from "./entry-dialog";
import { useGlAccounts, usePayees, useProjects } from "@/lib/data";
import { glLabel, TYPE_LABEL } from "@/lib/accounts";
import { initials } from "@/lib/format";
import type { LedgerEntryType } from "@/lib/types";

const nav = [
  { name: "Home", to: "/" as const, icon: Home },
  { name: "Transactions", to: "/transactions" as const, icon: ArrowLeftRight },
  { name: "Accounts", to: "/accounts" as const, icon: Landmark },
  { name: "Budget", to: "/budget" as const, icon: PiggyBank },
  { name: "Recurring", to: "/recurring" as const, icon: Repeat },
  { name: "Projects", to: "/projects" as const, icon: FolderKanban },
  { name: "Reports", to: "/reports" as const, icon: ChartNoAxesCombined },
  { name: "Settings", to: "/settings" as const, icon: Settings },
];

const NEW_ITEMS: { label: string; type: LedgerEntryType | "value" }[] = [
  { label: "Expense", type: "expense" },
  { label: "Deposit", type: "deposit" },
  { label: "Transfer", type: "transfer" },
  { label: "Value update", type: "value" },
  { label: "Journal entry", type: "journal" },
];

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="brand">
      {collapsed ? (
        <BrandLogo variant="mark" />
      ) : (
        <>
          <div className="brand-text">
            <BrandLogo />
            <div className="brand-sub">PERSONAL BOOKS</div>
          </div>
          <span className="brand-icon hidden">
            <BrandLogo variant="mark" />
          </span>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState<LedgerEntryType | "value" | "">("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { member, signOut } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (path === "/login") return <>{children}</>;

  return (
    <PeekProvider>
      <div className="app-shell">
        <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Main navigation">
          <SidebarBrand collapsed={collapsed} />
          <div className="nav-section">BOOKS</div>
          <nav className="nav-list">
            {nav.map((item, i) => (
              <div key={item.to}>
                {i === 7 && <div className="my-3 border-t border-sidebar-accent" />}
                <Button
                  asChild
                  variant={
                    (item.to === "/" ? path === "/" : path.startsWith(item.to))
                      ? "sidebarActive"
                      : "sidebar"
                  }
                  className="nav-link w-full"
                  title={item.name}
                >
                  <Link to={item.to}>
                    <item.icon />
                    {!collapsed && <span className="nav-label">{item.name}</span>}
                  </Link>
                </Button>
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-meta px-3 pb-3">
              <div className="text-xs text-sidebar-accent-foreground">Kane Books</div>
              <div className="mt-1 text-[length:calc(10px*var(--ts,1))]">
                Every dollar, accounted for.
              </div>
            </div>
            <Button
              variant="sidebar"
              className="nav-link w-full"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              {!collapsed && <span className="nav-label">Collapse sidebar</span>}
            </Button>
          </div>
        </aside>
        <div className="app-main">
          <header className="topbar">
            <button
              type="button"
              className="search-box flex h-9 items-center rounded-md bg-muted pl-9 text-left text-xs text-muted-foreground"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
            >
              <Search />
              <span className="search-label">Search accounts, payees, projects...</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="topbar-spacer" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" aria-label="New">
                  <Plus />
                  <span className="new-label">New</span>
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {NEW_ITEMS.map((x) => (
                  <DropdownMenuItem key={x.type} onSelect={() => setCreating(x.type)}>
                    <Plus className="size-3" />
                    {x.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="topbar-divider h-6 border-l border-border" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-0">
                  <span className="user-avatar">{initials(member?.full_name)}</span>
                  <span className="user-name text-xs">{member?.full_name ?? ""}</span>
                  <ChevronDown className="user-chevron size-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {member?.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings" search={{ tab: "Accessibility" }}>
                    <Accessibility />
                    Accessibility
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => signOut()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <main className="page-content">
            {children}
            <footer className="page-footer">
              <span>
                KANE BOOKS <span className="mx-2">/</span> PERSONAL
              </span>
              <span>Private to {member?.full_name ?? "you"}</span>
            </footer>
          </main>
        </div>
        {creating && creating !== "value" && (
          <EntryDialog type={creating} onClose={() => setCreating("")} />
        )}
        {creating === "value" && <ValueDialog onClose={() => setCreating("")} />}
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </PeekProvider>
  );
}

function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { show } = usePeek();
  const { data: accounts } = useGlAccounts();
  const { data: payees } = usePayees();
  const { data: projects } = useProjects();
  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search accounts, categories, payees, projects..." />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Pages">
          {nav.map((n) => (
            <CommandItem
              key={n.to}
              value={`page ${n.name}`}
              onSelect={() => go(() => navigate({ to: n.to }))}
            >
              <n.icon />
              {n.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Accounts and categories">
          {accounts
            ?.filter((a) => a.is_active)
            .map((a) => (
              <CommandItem
                key={a.id}
                value={`account ${a.number ?? ""} ${a.name} ${a.category_group ?? ""} ${a.account_type}`}
                onSelect={() => go(() => show({ kind: "gl", id: a.id }))}
              >
                <Landmark />
                {glLabel(a)}
                <span className="ml-auto text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                  {TYPE_LABEL[a.account_type]}
                </span>
              </CommandItem>
            ))}
        </CommandGroup>
        <CommandGroup heading="Payees">
          {payees?.map((p) => (
            <CommandItem
              key={p.id}
              value={`payee ${p.name}`}
              onSelect={() => go(() => show({ kind: "payee", id: p.id }))}
            >
              <Users />
              {p.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Projects">
          {projects?.map((p) => (
            <CommandItem
              key={p.id}
              value={`project ${p.name}`}
              onSelect={() => go(() => show({ kind: "project", id: p.id }))}
            >
              <TrendingUp />
              {p.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
