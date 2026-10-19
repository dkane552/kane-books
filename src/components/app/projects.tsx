// Projects: side ventures (Venture City, the trading bot) and anything else worth its own profit and loss.
// Lines in the books carry a project; report_pl_by_project and report_project_detail add them up.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, FolderKanban, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DataTable,
  EmptyState,
  Field,
  FormDialog,
  LoadingRows,
  Money,
  PageHeading,
  Panel,
  StatusPill,
} from "./shared";
import { PeekName } from "./peek";
import { useDb, useProjects, useReport } from "@/lib/data";
import { supabase, unwrap } from "@/lib/supabase";
import { fmtDate, money, num, todayISO } from "@/lib/format";
import type { GlRow, PnlProjectRow, PnlRow, Project } from "@/lib/types";

const PERIODS: Record<string, () => [string, string]> = {
  "This year": () => [`${new Date().getFullYear()}-01-01`, todayISO()],
  "Last year": () => [
    `${new Date().getFullYear() - 1}-01-01`,
    `${new Date().getFullYear() - 1}-12-31`,
  ],
  "All time": () => ["1900-01-01", todayISO()],
};
type Period = string;

export function ProjectsPage({ project }: { project?: string | undefined }) {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const [period, setPeriod] = useState<Period>("This year");
  const [from, to] = (PERIODS[period] ?? PERIODS["This year"]!)();
  const pl = useReport<PnlProjectRow>("report_pl_by_project", { p_from: from, p_to: to });
  const [editing, setEditing] = useState<Partial<Project> | null>(null);
  const selected = projects?.find((p) => p.id === project);
  const totals = (id: string) => pl.data?.find((r) => r.project_id === id);
  return (
    <>
      <PageHeading
        title="Projects"
        eyebrow="SIDE VENTURES AND MORE"
        subtitle="Tag income and spending to a project and see what each one makes or costs."
      >
        <select
          aria-label="Period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
        >
          {Object.keys(PERIODS).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <Button size="sm" onClick={() => setEditing({ is_business: true, is_active: true })}>
          <Plus />
          New project
        </Button>
      </PageHeading>
      <Panel title="Projects" meta={projects?.length ?? 0}>
        <DataTable
          rows={projects}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) =>
            navigate({ to: "/projects", search: { project: r.id }, replace: true })
          }
          columns={[
            {
              key: "name",
              header: "Project",
              sortValue: (r) => r.name,
              render: (r) => (
                <span
                  className={`flex items-center gap-2 ${r.is_active ? "" : "text-muted-foreground"}`}
                >
                  {r.is_business ? (
                    <Briefcase className="size-3.5 text-brass" />
                  ) : (
                    <FolderKanban className="size-3.5 text-muted-foreground" />
                  )}
                  <span className={r.id === project ? "font-semibold" : ""}>{r.name}</span>
                  {!r.is_active && <StatusPill tone="void">Closed</StatusPill>}
                </span>
              ),
            },
            {
              key: "kind",
              header: "Kind",
              render: (r) => (r.is_business ? "Business" : "Personal"),
            },
            {
              key: "inc",
              header: "Income",
              numeric: true,
              sortValue: (r) => num(totals(r.id)?.income),
              render: (r) => <Money value={totals(r.id)?.income ?? 0} blankZero />,
            },
            {
              key: "sp",
              header: "Spending",
              numeric: true,
              sortValue: (r) => num(totals(r.id)?.spending),
              render: (r) => <Money value={totals(r.id)?.spending ?? 0} blankZero />,
            },
            {
              key: "net",
              header: "Net",
              numeric: true,
              sortValue: (r) => num(totals(r.id)?.net),
              render: (r) => <Money value={totals(r.id)?.net ?? 0} />,
            },
            {
              key: "edit",
              header: "",
              render: (r) => (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit ${r.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(r);
                  }}
                >
                  <Pencil />
                </Button>
              ),
            },
          ]}
          empty={
            <EmptyState
              compact
              icon={FolderKanban}
              title="No projects yet"
              description="Make one for each side business (Venture City, the trading bot) or anything you want to track on its own."
            />
          }
          footerNote="Business projects get their own Schedule C page in the tax pack."
        />
      </Panel>
      {selected && (
        <>
          <div className="h-6" />
          <ProjectDetail project={selected} from={from} to={to} period={period} />
        </>
      )}
      {editing && <ProjectDialog project={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProjectDetail({
  project,
  from,
  to,
  period,
}: {
  project: Project;
  from: string;
  to: string;
  period: string;
}) {
  const q = useReport<PnlRow>("report_project_detail", {
    p_project: project.id,
    p_from: from,
    p_to: to,
  });
  const lines = useQuery({
    queryKey: ["db", "v_gl", "project", project.id, from, to],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("v_gl")
          .select("*")
          .eq("project_id", project.id)
          .gte("txn_date", from)
          .lte("txn_date", to)
          .in("classification", ["Revenue", "Expense"])
          .order("txn_date", { ascending: false })
          .limit(500),
      ) as GlRow[],
  });
  const rows = q.data ?? [];
  const income = rows
    .filter((r) => r.section.endsWith("ncome"))
    .reduce((s, r) => s + num(r.amount), 0);
  const spending = rows
    .filter((r) => r.section.endsWith("pending"))
    .reduce((s, r) => s + num(r.amount), 0);
  return (
    <div className="home-grid">
      <Panel title={project.name} meta={period}>
        <div className="grid grid-cols-3 gap-2 px-5 py-4 text-xs">
          {[
            ["Income", income],
            ["Spending", spending],
            ["Net", income - spending],
          ].map(([t, v]) => (
            <div key={t as string}>
              <div className="text-muted-foreground">{t}</div>
              <div className={`number text-base ${num(v as number) < 0 ? "text-destructive" : ""}`}>
                {money(v as number)}
              </div>
            </div>
          ))}
        </div>
        {project.description && (
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">{project.description}</p>
        )}
        {q.isLoading ? (
          <LoadingRows rows={2} />
        ) : !rows.length ? (
          <EmptyState
            compact
            title="Nothing tagged to this project in this period"
            description="Pick the project on a transaction's line to tag it."
          />
        ) : (
          <table className="data-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.gl_account_id}>
                  <td>
                    <PeekName target={{ kind: "gl", id: r.gl_account_id, from, to }}>
                      {r.account_name}
                    </PeekName>
                    <span className="ml-2 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                      {r.section}
                    </span>
                  </td>
                  <td className="text-right">
                    <Money value={r.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Transactions" meta={lines.data?.length ?? 0}>
        {lines.isLoading ? (
          <LoadingRows rows={3} />
        ) : !(lines.data ?? []).length ? (
          <p className="px-5 py-4 text-xs text-muted-foreground">None in this period.</p>
        ) : (
          <ul className="divide-y text-xs">
            {(lines.data ?? []).map((l) => (
              <li key={l.line_id} className="flex items-center gap-3 px-[18px] py-2">
                <span className="w-20 text-muted-foreground">{fmtDate(l.txn_date)}</span>
                <span className="min-w-0 flex-1">
                  <PeekName target={{ kind: "entry", id: l.source_id }}>
                    <span className="block truncate">
                      {l.party_name || l.memo || l.account_name}
                    </span>
                  </PeekName>
                  <span className="block text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                    {l.account_name}
                  </span>
                </span>
                <Money value={-num(l.amount)} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ProjectDialog({ project, onClose }: { project: Partial<Project>; onClose: () => void }) {
  const db = useDb();
  const [f, setF] = useState({
    name: project.name ?? "",
    description: project.description ?? "",
    is_business: project.is_business ?? true,
    is_active: project.is_active ?? true,
    started_on: project.started_on ?? "",
  });
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={project.id ? `Edit ${project.name}` : "New project"}
      busy={db.pending}
      onSubmit={async () => {
        if (!f.name.trim()) return void toast.error("Name it");
        const values = {
          name: f.name.trim(),
          description: f.description || null,
          is_business: f.is_business,
          is_active: f.is_active,
          started_on: f.started_on || null,
        };
        if (project.id) await db.update("projects", project.id, values);
        else await db.insert("projects", values);
        onClose();
      }}
    >
      <Field label="Name" full>
        <Input
          required
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="Venture City"
        />
      </Field>
      <Field label="What it is" full>
        <Input
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </Field>
      <Field label="Started">
        <Input
          type="date"
          value={f.started_on}
          onChange={(e) => setF({ ...f, started_on: e.target.value })}
        />
      </Field>
      <div className="flex flex-col justify-end gap-2 text-xs">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={f.is_business}
            onCheckedChange={(v) => setF({ ...f, is_business: v === true })}
          />
          A business (its own Schedule C in the tax pack)
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={f.is_active}
            onCheckedChange={(v) => setF({ ...f, is_active: v === true })}
          />
          Active (shows in the pickers)
        </label>
      </div>
    </FormDialog>
  );
}
