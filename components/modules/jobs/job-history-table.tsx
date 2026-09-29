"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Database,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  explainErrorsPrompt,
  useAssistant,
} from "@/components/modules/assistant/assistant-provider";
import HealthReportModal, {
  HEALTH_BADGE_CLASS,
  type HealthLevel,
} from "./health-report-modal";

// ============================================
// Types & helpers
// ============================================

export type JobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "VALIDATING"
  | "COMPLETED"
  | "FAILED";

/** Serialized GenerationJob as returned by the /api/jobs routes. */
export interface JobRow {
  id: string;
  status: JobStatus;
  progress: number;
  rowCount: number | null;
  seed: number | null;
  exportUrl: string | null;
  validationErrors: unknown;
  /** Set by the worker's audit: true when no ERROR issues were found. */
  healthCheckPassed: boolean | null;
  /** Issue counts from the latest ValidationResult summary. */
  health: { errorCount: number; warningCount: number } | null;
  /** "invoice" | "statement" for DOCUMENT jobs (PDF output); null for data jobs. */
  documentType: string | null;
  createdAt: string;
  completedAt: string | null;
}

type RawJob = Omit<JobRow, "health" | "documentType"> & {
  validationResults?: { summary?: unknown; createdAt?: string }[];
  documentConfig?: { template?: { layoutConfig?: { documentType?: unknown } } } | null;
};

interface JobErrorItem {
  message: string;
  field?: string;
  severity?: string;
  code?: string;
}

const POLL_INTERVAL_MS = 2000;
const JOB_LIST_LIMIT = 25;

function isActive(status: JobStatus): boolean {
  return status === "QUEUED" || status === "PROCESSING" || status === "VALIDATING";
}

/** Reads issue counts from the newest ValidationResult summary. */
function healthCounts(raw: RawJob): JobRow["health"] {
  const latest = (raw.validationResults ?? [])
    .slice()
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
  const summary = latest?.summary as { errorCount?: unknown; warningCount?: unknown } | undefined;
  if (!summary || typeof summary !== "object") return null;
  const count = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
  return { errorCount: count(summary.errorCount), warningCount: count(summary.warningCount) };
}

/** Strips the relations the /api/jobs routes include, keeping only row fields. */
export function toJobRow(raw: RawJob): JobRow {
  return {
    id: raw.id,
    status: raw.status,
    progress: raw.progress,
    rowCount: raw.rowCount,
    seed: raw.seed,
    exportUrl: raw.exportUrl,
    validationErrors: raw.validationErrors,
    healthCheckPassed: raw.healthCheckPassed ?? null,
    health: healthCounts(raw),
    documentType:
      typeof raw.documentConfig?.template?.layoutConfig?.documentType === "string"
        ? raw.documentConfig.template.layoutConfig.documentType
        : null,
    createdAt: raw.createdAt,
    completedAt: raw.completedAt,
  };
}

/** Green = passed, yellow = passed with warnings, red = errors; null when not audited. */
function healthLevel(job: JobRow): HealthLevel | null {
  if (job.status !== "COMPLETED" || job.healthCheckPassed === null) return null;
  if (!job.healthCheckPassed) return "FAILED";
  return job.health && job.health.warningCount > 0 ? "WARNINGS" : "PASSED";
}

function normalizeErrors(value: unknown): JobErrorItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): JobErrorItem[] => {
    if (typeof item === "string") return [{ message: item }];
    if (item && typeof item === "object" && "message" in item) {
      const e = item as Record<string, unknown>;
      return [
        {
          message: String(e.message),
          field: typeof e.field === "string" ? e.field : undefined,
          severity: typeof e.severity === "string" ? e.severity : undefined,
          code: typeof e.code === "string" ? e.code : undefined,
        },
      ];
    }
    return [];
  });
}

/**
 * Only allow same-origin relative paths or http(s) URLs as download targets,
 * so a malformed URL (e.g. javascript:) can never be navigated to.
 */
function safeDownloadHref(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

type DownloadFormat = "zip" | "csv" | "sql" | "pdf";

/** Multi-table jobs store dataset.zip as their exportUrl; single-table jobs a CSV (plus a ZIP). */
function primaryExportFormat(exportUrl: string | null): "zip" | "csv" | "pdf" | null {
  const href = safeDownloadHref(exportUrl);
  if (!href) return null;
  const pathname = new URL(href, "http://localhost").pathname.toLowerCase();
  if (pathname.endsWith(".pdf")) return "pdf";
  return pathname.endsWith(".zip") ? "zip" : "csv";
}

/** Resolves a fresh presigned URL for one of the job's exports. */
async function fetchDownloadUrl(jobId: string, format: DownloadFormat): Promise<string> {
  const res = await fetch(`/api/jobs/${jobId}/download?format=${format}`, {
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  const href = safeDownloadHref(body.url ?? null);
  if (!href) throw new Error("The server returned an invalid download link");
  return href;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function fetchWorkspaceJobs(
  workspaceId: string,
  signal?: AbortSignal
): Promise<JobRow[]> {
  const params = new URLSearchParams({
    workspaceId,
    limit: String(JOB_LIST_LIMIT),
  });
  const res = await fetch(`/api/jobs?${params}`, { cache: "no-store", signal });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data: RawJob[] };
  return body.data.map(toJobRow);
}

// ============================================
// useWorkspaceJobs — list state shared by the table and the modal
// ============================================

export function useWorkspaceJobs(workspaceId: string) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Latest jobs, read when deciding whether a poll result is a transition
  const jobsRef = useRef<JobRow[]>([]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // Initial load — state is only set from the promise callbacks
  useEffect(() => {
    const controller = new AbortController();
    fetchWorkspaceJobs(workspaceId, controller.signal)
      .then((data) => {
        setJobs(data);
        setLoadError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLoadError(err instanceof Error ? err.message : "Unknown error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setJobs(await fetchWorkspaceJobs(workspaceId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  /** Insert a new job at the top, or replace an existing one in place. */
  const upsertJob = useCallback((incoming: JobRow) => {
    const previous = jobsRef.current.find((j) => j.id === incoming.id);

    // Toast only on an observed transition; the id dedupes overlapping polls
    if (previous && isActive(previous.status)) {
      if (incoming.status === "COMPLETED" && incoming.healthCheckPassed === false) {
        toast.warning("Generation complete — health check failed", {
          id: `job-done-${incoming.id}`,
          description: "Open the job's Health Report to see which rows and columns failed.",
        });
      } else if (incoming.status === "COMPLETED") {
        toast.success("Generation complete", {
          id: `job-done-${incoming.id}`,
          description: incoming.documentType
            ? `${formatJobSize(incoming)} rendered to PDF and ready to download.`
            : `${incoming.rowCount?.toLocaleString() ?? "All"} rows are ready to download.`,
        });
      } else if (incoming.status === "FAILED") {
        const archiveFailed = normalizeErrors(incoming.validationErrors).some(
          (e) => e.code === "ARCHIVE_ERROR"
        );
        toast.error(archiveFailed ? "ZIP archiving failed" : "Generation failed", {
          id: `job-done-${incoming.id}`,
          description: archiveFailed
            ? "The tables were generated but could not be packaged into dataset.zip."
            : "Open the job's error details for more information.",
        });
      }
    }

    setJobs((current) => {
      const index = current.findIndex((j) => j.id === incoming.id);
      if (index === -1) return [incoming, ...current];
      const next = current.slice();
      next[index] = incoming;
      return next;
    });
  }, []);

  return { jobs, isLoading, loadError, reload, upsertJob };
}

// ============================================
// useJobPolling — polls one active job until it reaches a terminal status
// ============================================

function useJobPolling(job: JobRow, onUpdate: (job: JobRow) => void) {
  const active = isActive(job.status);

  // Keep the latest callback without restarting the interval
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();
    let inFlight = false;

    const tick = async () => {
      if (inFlight) return; // never stack requests on a slow response
      inFlight = true;
      try {
        const res = await fetch(`/api/jobs/${job.id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.status === 404 || res.status === 403) {
          clearInterval(intervalId); // job gone or not ours — stop polling
          return;
        }
        if (!res.ok) return; // transient error — try again next tick
        const raw = await res.json();
        if (!controller.signal.aborted) onUpdateRef.current(toJobRow(raw));
      } catch {
        // Network error or abort — the next tick (if any) retries
      } finally {
        inFlight = false;
      }
    };

    const intervalId = setInterval(tick, POLL_INTERVAL_MS);

    // Cleared on unmount, and whenever the job leaves an active status
    return () => {
      clearInterval(intervalId);
      controller.abort();
    };
  }, [job.id, active]);
}

// ============================================
// Row pieces
// ============================================

const STATUS_BADGE_CLASS: Record<JobStatus, string> = {
  QUEUED:
    "border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
  PROCESSING:
    "border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
  VALIDATING:
    "border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
  COMPLETED:
    "border-transparent bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  FAILED:
    "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

const HEALTH_BADGE_META: Record<HealthLevel, { label: string; icon: typeof ShieldCheck }> = {
  PASSED: { label: "Healthy", icon: ShieldCheck },
  WARNINGS: { label: "Warnings", icon: ShieldAlert },
  FAILED: { label: "Failed checks", icon: ShieldX },
};

/** Clickable health score for audited jobs; the plain status badge otherwise. */
function HealthBadge({ job, onOpen }: { job: JobRow; onOpen: (job: JobRow) => void }) {
  const level = healthLevel(job);
  if (!level) return <StatusBadge status={job.status} />;

  const { label, icon: Icon } = HEALTH_BADGE_META[level];
  const counts = job.health;
  const detail =
    level === "FAILED" && counts
      ? ` · ${counts.errorCount}`
      : level === "WARNINGS" && counts
        ? ` · ${counts.warningCount}`
        : "";
  return (
    <button
      type="button"
      onClick={() => onOpen(job)}
      className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      aria-label={`${label}: open health report`}
      title="View health report"
    >
      <Badge
        variant="outline"
        className={cn("cursor-pointer gap-1 hover:opacity-80", HEALTH_BADGE_CLASS[level])}
      >
        <Icon className="size-3" />
        {label}
        {detail}
      </Badge>
    </button>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge variant="outline" className={cn("gap-1", STATUS_BADGE_CLASS[status])}>
      {isActive(status) && <Loader2 className="size-3 animate-spin" />}
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

const DOWNLOAD_OPTIONS: Record<
  DownloadFormat,
  { label: string; icon: typeof FileArchive }
> = {
  zip: { label: "Download ZIP (CSV + JSON)", icon: FileArchive },
  csv: { label: "Download CSV", icon: FileSpreadsheet },
  sql: { label: "Download SQL Dump", icon: Database },
  pdf: { label: "Download PDF", icon: FileText },
};

/** "12 invoices" for document jobs, "1,000" rows otherwise. */
function formatJobSize(job: JobRow): string {
  if (job.rowCount === null) return "—";
  if (!job.documentType) return job.rowCount.toLocaleString();
  const noun = job.documentType === "statement" ? "statement" : "invoice";
  return `${job.rowCount.toLocaleString()} ${noun}${job.rowCount === 1 ? "" : "s"}`;
}

function DownloadButtons({ job }: { job: JobRow }) {
  const [pending, setPending] = useState<DownloadFormat | null>(null);
  const primary = primaryExportFormat(job.exportUrl);

  if (!primary) return <span className="text-xs">No export available</span>;

  async function handleDownload(format: DownloadFormat) {
    setPending(format);
    try {
      window.location.assign(await fetchDownloadUrl(job.id, format));
    } catch (err) {
      toast.error(`${DOWNLOAD_OPTIONS[format].label} failed`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setPending(null);
    }
  }

  // Single-table jobs lead with the plain CSV; every job has the ZIP (CSV + JSON + SQL)
  const formats: DownloadFormat[] =
    primary === "pdf" ? ["pdf"] : primary === "csv" ? ["csv", "zip", "sql"] : ["zip", "sql"];

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {formats.map((format, i) => {
        const { label, icon: Icon } = DOWNLOAD_OPTIONS[format];
        return (
          <Button
            key={format}
            size="sm"
            variant={i === 0 ? "default" : "outline"}
            disabled={pending !== null}
            onClick={() => handleDownload(format)}
          >
            {pending === format ? <Loader2 className="animate-spin" /> : <Icon />}
            {label}
          </Button>
        );
      })}
    </div>
  );
}

interface JobRowViewProps {
  job: JobRow;
  onUpdate: (job: JobRow) => void;
  onViewError: (job: JobRow) => void;
  onViewHealth: (job: JobRow) => void;
}

function JobRowView({ job, onUpdate, onViewError, onViewHealth }: JobRowViewProps) {
  useJobPolling(job, onUpdate);

  const active = isActive(job.status);

  return (
    <TableRow
      className={cn(
        "transition-colors",
        active
          ? "bg-yellow-50/70 shadow-[inset_3px_0_0_var(--color-yellow-400)] dark:bg-yellow-500/5"
          : "text-[var(--color-muted-foreground)]"
      )}
    >
      <TableCell className="font-mono text-xs" title={job.id}>
        {job.id.slice(-8)}
      </TableCell>
      <TableCell>{formatDate(job.createdAt)}</TableCell>
      <TableCell className="tabular-nums">
        {formatJobSize(job)}
      </TableCell>
      <TableCell>
        <HealthBadge job={job} onOpen={onViewHealth} />
      </TableCell>
      <TableCell className="w-48">
        <div className="flex items-center gap-2">
          <Progress
            value={job.status === "COMPLETED" ? 100 : job.progress}
            className="h-1.5"
            indicatorClassName={cn(
              job.status === "COMPLETED" && "bg-green-500",
              job.status === "FAILED" && "bg-red-500",
              active && "bg-yellow-500"
            )}
          />
          <span className="w-9 text-right text-xs tabular-nums">
            {job.status === "COMPLETED" ? 100 : job.progress}%
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        {job.status === "COMPLETED" && <DownloadButtons job={job} />}
        {job.status === "FAILED" && (
          <Button size="sm" variant="outline" onClick={() => onViewError(job)}>
            <AlertTriangle />
            View Error
          </Button>
        )}
        {active && <span className="text-xs">Running…</span>}
      </TableCell>
    </TableRow>
  );
}

// ============================================
// JobHistoryTable
// ============================================

interface JobHistoryTableProps {
  jobs: JobRow[];
  isLoading: boolean;
  loadError: string | null;
  onReload: () => void;
  onJobUpdate: (job: JobRow) => void;
}

export default function JobHistoryTable({
  jobs,
  isLoading,
  loadError,
  onReload,
  onJobUpdate,
}: JobHistoryTableProps) {
  const [errorJob, setErrorJob] = useState<JobRow | null>(null);
  const [healthJobId, setHealthJobId] = useState<string | null>(null);
  const { openAssistant } = useAssistant();
  const activeCount = jobs.filter((j) => isActive(j.status)).length;
  const errors = errorJob ? normalizeErrors(errorJob.validationErrors) : [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Job History</h2>
          {activeCount > 0 && (
            <Badge variant="outline" className={STATUS_BADGE_CLASS.PROCESSING}>
              {activeCount} running
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReload}
          disabled={isLoading}
          aria-label="Refresh job history"
        >
          <RefreshCw className={cn(isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && jobs.length === 0 ? (
            <div className="flex flex-col gap-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full rounded-md" />
              ))}
            </div>
          ) : loadError && jobs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-[var(--color-destructive)]">
                Failed to load jobs: {loadError}
              </p>
              <Button variant="outline" size="sm" onClick={onReload}>
                Try again
              </Button>
            </div>
          ) : jobs.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--color-muted-foreground)]">
              No jobs run yet. Generate your first dataset!
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Row Count</TableHead>
                  <TableHead>Status / Health</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <JobRowView
                    key={job.id}
                    job={job}
                    onUpdate={onJobUpdate}
                    onViewError={setErrorJob}
                    onViewHealth={(j) => setHealthJobId(j.id)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <HealthReportModal jobId={healthJobId} onClose={() => setHealthJobId(null)} />

      <Dialog open={errorJob !== null} onOpenChange={(open) => !open && setErrorJob(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Job failed</DialogTitle>
            <DialogDescription>
              Job <span className="font-mono">{errorJob?.id}</span>
            </DialogDescription>
          </DialogHeader>
          {errors.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No error details were recorded for this job.
            </p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {errors.map((err, i) => (
                <li
                  key={i}
                  className="rounded-md border border-[var(--color-border)] p-3 text-sm"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {err.severity && (
                      <Badge
                        variant="outline"
                        className={
                          err.severity === "error"
                            ? STATUS_BADGE_CLASS.FAILED
                            : STATUS_BADGE_CLASS.QUEUED
                        }
                      >
                        {err.severity}
                      </Badge>
                    )}
                    {err.field && <span className="font-mono text-xs">{err.field}</span>}
                    {err.code && (
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        {err.code}
                      </span>
                    )}
                  </div>
                  <p className="break-words">{err.message}</p>
                </li>
              ))}
            </ul>
          )}
          {errors.length > 0 && errorJob && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => {
                const prompt = explainErrorsPrompt(
                  `errors from failed generation job ${errorJob.id}`,
                  errors
                );
                setErrorJob(null);
                openAssistant({ send: prompt });
              }}
            >
              <Sparkles />
              Explain with AI
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
