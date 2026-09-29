"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Link2,
  Loader2,
  Percent,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  explainErrorsPrompt,
  useAssistant,
} from "@/components/modules/assistant/assistant-provider";

// ============================================
// Types (mirror lib/engine/auditor.ts, serialized by GET /api/jobs/[id]/validate)
// ============================================

export type HealthLevel = "PASSED" | "WARNINGS" | "FAILED";

type AuditCheck = "REFERENTIAL_INTEGRITY" | "NULL_RATE" | "UNIQUENESS" | "EMPTY_TABLE";

interface AuditIssue {
  table: string;
  column: string;
  type: "WARNING" | "ERROR";
  check?: AuditCheck;
  message: string;
  count?: number;
  sampleRows?: number[];
  sampleValues?: string[];
}

interface ColumnAuditStats {
  table: string;
  column: string;
  rows: number;
  nulls: number;
  actualNullRate: number;
  expectedNullRate: number;
  isPrimaryKey: boolean;
  isUnique: boolean;
  references?: string;
}

interface AuditSummary {
  tablesChecked?: number;
  rowsChecked?: number;
  errorCount?: number;
  warningCount?: number;
  checks?: Partial<
    Record<Exclude<AuditCheck, "EMPTY_TABLE">, { columnsChecked: number; violations: number }>
  >;
  columns?: ColumnAuditStats[];
  auditedAt?: string;
  durationMs?: number;
}

interface HealthReport {
  isPassed: boolean;
  summary: AuditSummary;
  issues: AuditIssue[];
}

// ============================================
// Shared badge styles (also used by the Job History table)
// ============================================

export const HEALTH_BADGE_CLASS: Record<HealthLevel, string> = {
  PASSED:
    "border-transparent bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  WARNINGS:
    "border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
  FAILED:
    "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

const CHECK_META: Record<AuditCheck, { label: string; icon: typeof Link2 }> = {
  REFERENTIAL_INTEGRITY: { label: "Referential integrity", icon: Link2 },
  NULL_RATE: { label: "Null rates", icon: Percent },
  UNIQUENESS: { label: "Uniqueness", icon: KeyRound },
  EMPTY_TABLE: { label: "Empty table", icon: AlertTriangle },
};

function levelOf(report: HealthReport): HealthLevel {
  if (!report.isPassed) return "FAILED";
  return report.issues.length > 0 ? "WARNINGS" : "PASSED";
}

function normalizeReport(raw: unknown): HealthReport {
  const body = (raw ?? {}) as Record<string, unknown>;
  const issues = Array.isArray(body.issues)
    ? (body.issues as unknown[]).filter(
        (i): i is AuditIssue =>
          !!i && typeof i === "object" && typeof (i as AuditIssue).message === "string"
      )
    : [];
  const summary =
    body.summary && typeof body.summary === "object" ? (body.summary as AuditSummary) : {};
  return { isPassed: body.isPassed === true, summary, issues };
}

// ============================================
// Pieces
// ============================================

function CheckTile({
  check,
  stats,
}: {
  check: Exclude<AuditCheck, "EMPTY_TABLE">;
  stats?: { columnsChecked: number; violations: number };
}) {
  const { label, icon: Icon } = CHECK_META[check];
  const ok = !stats || stats.violations === 0;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-[var(--color-border)] p-3">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {ok ? (
          <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
        ) : (
          <XCircle className="size-4 text-red-600 dark:text-red-400" />
        )}
        {ok ? "No issues" : `${stats!.violations.toLocaleString()} flagged`}
      </div>
      <span className="text-xs text-[var(--color-muted-foreground)]">
        {stats?.columnsChecked ?? 0} column(s) checked
      </span>
    </div>
  );
}

function IssueItem({ issue }: { issue: AuditIssue }) {
  const isError = issue.type === "ERROR";
  const meta = issue.check ? CHECK_META[issue.check] : null;
  return (
    <li className="rounded-md border border-[var(--color-border)] p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={isError ? HEALTH_BADGE_CLASS.FAILED : HEALTH_BADGE_CLASS.WARNINGS}
        >
          {isError ? "Error" : "Warning"}
        </Badge>
        <span className="font-mono text-xs">
          {issue.table}
          {issue.column !== "*" && `.${issue.column}`}
        </span>
        {meta && (
          <span className="text-xs text-[var(--color-muted-foreground)]">{meta.label}</span>
        )}
      </div>
      <p className="break-words">{issue.message}</p>
      {issue.sampleRows && issue.sampleRows.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
          <span>
            Row{issue.sampleRows.length > 1 && "s"}:{" "}
            <span className="font-mono">{issue.sampleRows.map((r) => `#${r}`).join(", ")}</span>
            {issue.count !== undefined && issue.count > issue.sampleRows.length && (
              <> and {(issue.count - issue.sampleRows.length).toLocaleString()} more</>
            )}
          </span>
          {issue.sampleValues && issue.sampleValues.length > 0 && (
            <span className="break-all">
              Values:{" "}
              <span className="font-mono">
                {issue.sampleValues.map((v) => JSON.stringify(v)).join(", ")}
              </span>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function ColumnStatsTable({ columns }: { columns: ColumnAuditStats[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Column</TableHead>
          <TableHead>Constraints</TableHead>
          <TableHead className="text-right">Nulls</TableHead>
          <TableHead className="text-right">Actual</TableHead>
          <TableHead className="text-right">Configured</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((c) => {
          const drift = Math.abs(c.actualNullRate - c.expectedNullRate);
          return (
            <TableRow key={`${c.table}.${c.column}`}>
              <TableCell className="font-mono text-xs">
                {c.table}.{c.column}
              </TableCell>
              <TableCell className="text-xs text-[var(--color-muted-foreground)]">
                {[
                  c.isPrimaryKey && "PK",
                  c.isUnique && !c.isPrimaryKey && "Unique",
                  c.references && `→ ${c.references}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {c.nulls.toLocaleString()}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  drift > 2 && "text-yellow-700 dark:text-yellow-300",
                  c.expectedNullRate === 0 && c.nulls > 0 && "text-red-600 dark:text-red-400"
                )}
              >
                {c.actualNullRate}%
              </TableCell>
              <TableCell className="text-right tabular-nums">{c.expectedNullRate}%</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ============================================
// HealthReportModal
// ============================================

interface HealthReportModalProps {
  /** Job whose report to show; null closes the dialog. */
  jobId: string | null;
  onClose: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: HealthReport };

export default function HealthReportModal({ jobId, onClose }: HealthReportModalProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [showColumns, setShowColumns] = useState(false);
  const { openAssistant } = useAssistant();

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    fetch(`/api/jobs/${jobId}/validate`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        setState({ status: "ready", report: normalizeReport(body) });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      });
    return () => controller.abort();
  }, [jobId, attempt]);

  function handleOpenChange(open: boolean) {
    if (open) return;
    onClose();
    setState({ status: "loading" });
    setShowColumns(false);
  }

  const report = state.status === "ready" ? state.report : null;
  const level = report ? levelOf(report) : null;
  const errorCount = report?.issues.filter((i) => i.type === "ERROR").length ?? 0;
  const warningCount = (report?.issues.length ?? 0) - errorCount;
  const columns = report?.summary.columns ?? [];

  return (
    <Dialog open={jobId !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl grid-rows-[auto_1fr] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Health Report
            {level && (
              <Badge variant="outline" className={HEALTH_BADGE_CLASS[level]}>
                {level === "PASSED" ? "Passed" : level === "WARNINGS" ? "Warnings" : "Failed"}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Job <span className="font-mono">{jobId}</span>
            {report?.summary.rowsChecked !== undefined && (
              <>
                {" "}
                · {report.summary.rowsChecked.toLocaleString()} rows across{" "}
                {report.summary.tablesChecked} table(s)
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          {state.status === "loading" && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 className="size-4 animate-spin" />
              Loading report…
            </div>
          )}

          {state.status === "error" && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-[var(--color-destructive)]">
                Could not load the health report: {state.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setState({ status: "loading" });
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </Button>
            </div>
          )}

          {report && (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <CheckTile
                  check="REFERENTIAL_INTEGRITY"
                  stats={report.summary.checks?.REFERENTIAL_INTEGRITY}
                />
                <CheckTile check="NULL_RATE" stats={report.summary.checks?.NULL_RATE} />
                <CheckTile check="UNIQUENESS" stats={report.summary.checks?.UNIQUENESS} />
              </div>

              <section className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    Issues{" "}
                    <span className="font-normal text-[var(--color-muted-foreground)]">
                      ({errorCount} error{errorCount !== 1 && "s"}, {warningCount} warning
                      {warningCount !== 1 && "s"})
                    </span>
                  </h3>
                  {report.issues.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const prompt = explainErrorsPrompt(
                          `data health-check issues from job ${jobId}`,
                          report.issues
                        );
                        handleOpenChange(false);
                        openAssistant({ send: prompt });
                      }}
                    >
                      <Sparkles />
                      Explain with AI
                    </Button>
                  )}
                </div>
                {report.issues.length === 0 ? (
                  <p className="flex items-center gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm">
                    <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                    All checks passed. Foreign keys resolve, keys are unique and null rates
                    match the schema.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {report.issues.map((issue, i) => (
                      <IssueItem key={i} issue={issue} />
                    ))}
                  </ul>
                )}
              </section>

              {columns.length > 0 && (
                <section className="flex flex-col gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => setShowColumns((v) => !v)}
                  >
                    {showColumns ? "Hide" : "Show"} column statistics ({columns.length})
                  </Button>
                  {showColumns && <ColumnStatsTable columns={columns} />}
                </section>
              )}

              {report.summary.auditedAt && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Audited {new Date(report.summary.auditedAt).toLocaleString()}
                  {report.summary.durationMs !== undefined &&
                    ` in ${report.summary.durationMs.toLocaleString()} ms`}
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
