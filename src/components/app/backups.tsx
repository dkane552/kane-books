import { Copy, DatabaseBackup, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel, EmptyState, LoadingRows } from "./shared";
import { useBackupLog } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import script from "../../../scripts/backup-to-drive.gs?raw";

export function BackupsPanel() {
  const { data: log, isLoading } = useBackupLog();
  const last = log?.[0];
  const stale = !last || Date.now() - new Date(last.at).getTime() > 36 * 3600 * 1000;

  function copyScript() {
    navigator.clipboard
      .writeText(script)
      .then(() =>
        toast.success("Backup script copied", {
          description: "Paste it into a new Apps Script project.",
        }),
      )
      .catch(() => toast.error("Could not copy the script"));
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Nightly backup to Google Drive">
        {isLoading ? (
          <LoadingRows rows={2} />
        ) : last ? (
          <div className="px-5 py-4 text-xs">
            <div className={stale ? "text-destructive" : ""}>
              <strong>Last backup {timeAgo(last.at)}</strong>
              <span className="text-muted-foreground">
                {" · "}
                {last.tables} tables, {Number(last.rows).toLocaleString()} rows, {last.files} files
              </span>
            </div>
            {stale && (
              <p className="mt-1 text-destructive">
                No backup in the last day and a half. Open the Apps Script project and check its
                executions, or run runBackup by hand.
              </p>
            )}
          </div>
        ) : (
          <EmptyState
            compact
            icon={DatabaseBackup}
            title="No backups yet"
            description="Set up the free nightly copy to your Google Drive with the steps below."
          />
        )}
      </Panel>

      <Panel
        title="Setup (one time, about 5 minutes)"
        action={
          <Button size="sm" variant="outline" onClick={copyScript}>
            <Copy />
            Copy backup script
          </Button>
        }
      >
        <ol className="list-decimal space-y-2 py-4 pl-10 pr-5 text-xs leading-relaxed">
          <li>
            Click <strong>Copy backup script</strong>, then open{" "}
            <a
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href="https://script.google.com/home/projects/create"
              target="_blank"
              rel="noreferrer"
            >
              a new Apps Script project <ExternalLink className="size-3" />
            </a>{" "}
            while signed in to the Google account that should hold the backups. Replace the sample
            code with the script and save.
          </li>
          <li>
            Pick <strong>setup</strong> in the function menu and click <strong>Run</strong>. Approve
            the permissions (Drive, sending you an email if a backup fails, and calling the app).
          </li>
          <li>
            Copy the backup token from the execution log. In Supabase, go to Edge Functions,
            Secrets, add <code>BACKUP_TOKEN</code> with that token, and save.
          </li>
          <li>
            Pick <strong>runBackup</strong> and click Run. A <em>Kane Books Backups</em> folder
            appears in Drive with the data and a copy of every photo and file.
          </li>
        </ol>
        <p className="border-t px-5 py-3 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
          After that it runs every night around 2 AM, keeps 30 days of data copies, and emails you
          if a backup fails. QuickBooks sign-in tokens are never included.
        </p>
      </Panel>
    </div>
  );
}
