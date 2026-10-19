import { useMemo, useState, type ReactNode } from "react";
import { Inbox, Search, ArrowUp, ArrowDown, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { money, num } from "@/lib/format";
import type { Num } from "@/lib/types";

export function pageHead(title: string, description?: string) {
  return {
    meta: [
      { title: `${title} | Kane Books` },
      { name: "description", content: description ?? "Private personal books." },
    ],
  };
}

export function PageHeading({
  title,
  subtitle,
  eyebrow,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

export function Panel({
  title,
  meta,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <h2>
            {title} {meta !== undefined && <span className="number ml-2">{meta}</span>}
          </h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  icon?: typeof Inbox;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "min-h-[150px]" : ""}`}>
      <div className="empty-icon">
        <Icon />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function SearchField({
  placeholder = "Search...",
  value,
  onChange,
}: {
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div className="search-box">
      <Search />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}

export function Filter<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | "";
  onChange: (v: T | "") => void;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T | "")}>
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function LocalTabs({
  options,
  value,
  onChange,
  counts,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  counts?: Record<string, number>;
}) {
  return (
    <div className="tabs-strip" role="tablist">
      {options.map((x) => (
        <Button
          key={x}
          variant="ghost"
          role="tab"
          aria-selected={value === x}
          data-active={value === x}
          className="tab-link"
          onClick={() => onChange(x)}
        >
          {x}
          {counts?.[x] !== undefined && (
            <span className="number ml-1 text-[length:calc(10px*var(--ts,1))] opacity-70">
              {counts[x]}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "approved" | "pending" | "draft" | "denied" | "void";
  children: ReactNode;
}) {
  return <span className={`status ${tone}`}>{children}</span>;
}

/** Right-aligned mono money; red when negative. */
export function Money({
  value,
  blankZero = false,
  className = "",
}: {
  value: Num | undefined;
  blankZero?: boolean;
  className?: string;
}) {
  const n = num(value);
  if (blankZero && n === 0) return <span className={`number ${className}`} />;
  return (
    <span className={`number ${n < 0 ? "text-destructive" : ""} ${className}`}>{money(n)}</span>
  );
}

export function WarnTip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertTriangle className="size-3" />
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-5" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  numeric?: boolean;
  sortValue?: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
  className?: string;
  footer?: ReactNode;
}

/** Simple sortable table using the app's data-table styles. */
export function DataTable<T>({
  rows,
  columns,
  loading,
  empty,
  onRowClick,
  rowKey,
  initialSort,
  footerNote,
  showFooterRow,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  loading?: boolean;
  empty: ReactNode;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  footerNote?: ReactNode;
  showFooterRow?: boolean;
}) {
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    if (!rows) return [];
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return va > vb ? dir : -dir;
    });
  }, [rows, sort, columns]);

  return (
    <>
      <div className="data-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.numeric ? "numeric" : ""} ${c.sortValue ? "cursor-pointer select-none" : ""}`}
                  onClick={() =>
                    c.sortValue &&
                    setSort((s) => ({
                      key: c.key,
                      dir: s?.key === c.key && s.dir === "asc" ? "desc" : "asc",
                    }))
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {sort?.key === c.key &&
                      (sort.dir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      ))}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length}>
                  <LoadingRows />
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>{empty}</td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr
                  key={rowKey(r)}
                  className={onRowClick ? "cursor-pointer hover:bg-muted/60" : ""}
                  onClick={() => onRowClick?.(r)}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`${c.numeric ? "text-right" : ""} ${c.className ?? ""}`}
                    >
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {showFooterRow && sorted.length > 0 && (
            <tfoot>
              <tr className="bg-muted font-medium">
                {columns.map((c) => (
                  <td key={c.key} className={`${c.numeric ? "text-right" : ""} px-3 py-3`}>
                    {c.footer}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="table-footer">
        <span>
          <span className="number">{sorted.length}</span>{" "}
          {sorted.length === 1 ? "record" : "records"}
        </span>
        <span>{footerNote}</span>
      </div>
    </>
  );
}

/** Dialog with a form body and Cancel / Save buttons. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = "Save",
  busy,
  wide,
  footerLeft,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  busy?: boolean;
  wide?: boolean;
  footerLeft?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`max-h-[calc(var(--screen-h)*0.9)] overflow-auto ${wide ? "sm:max-w-3xl" : ""}`}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await onSubmit();
          }}
        >
          <div className="form-grid my-4 p-0">{children}</div>
          <div className="flex justify-end gap-2">
            {footerLeft && <div className="mr-auto">{footerLeft}</div>}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  full,
  children,
  hint,
}: {
  label: string;
  full?: boolean;
  children: ReactNode;
  hint?: string | undefined;
}) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      {label}
      {children}
      {hint && (
        <span className="text-[length:calc(10px*var(--ts,1))] text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

export function Select({
  value,
  onChange,
  children,
  required,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  required?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full"
    >
      {children}
    </select>
  );
}

/** Confirm before destructive actions. */
export function confirmAction(message: string) {
  return typeof window !== "undefined" ? window.confirm(message) : false;
}
