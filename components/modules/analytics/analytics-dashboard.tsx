"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { BarChart3, Loader2, MapPin, PieChart, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { JobDataset } from "@/lib/analytics/load-dataset";
import { detectGeoColumns, geoPoints, profileColumns } from "@/lib/analytics/aggregate";
import CategoricalCharts from "./charts/bar-pie-charts";
import DistributionCharts from "./charts/distribution-charts";
import { ChartCard, ColumnSelect, EmptyChart } from "./charts/chart-theme";

// Leaflet reads `window` at import time, so the map is client-only
const GeospatialMap = dynamic(() => import("./geospatial-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-[28rem] w-full rounded-lg" />,
});

const MAX_MAP_POINTS = 1000;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; dataset: JobDataset };

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col rounded-lg border border-[var(--color-border)] px-3 py-2">
      <span className="text-xs text-[var(--color-muted-foreground)]">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default function AnalyticsDashboard({ jobId }: { jobId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedTable, setSelectedTable] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/analytics`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        setState({ status: "ready", dataset: body as JobDataset });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: err instanceof Error ? err.message : "Unknown error" });
      });
    return () => controller.abort();
  }, [jobId, attempt]);

  const tables = state.status === "ready" ? state.dataset.tables : [];
  const table = tables.find((t) => t.name === selectedTable) ?? tables[0];
  const rows = useMemo(() => table?.rows ?? [], [table]);

  const columns = useMemo(() => profileColumns(rows), [rows]);
  const geo = useMemo(() => detectGeoColumns(rows, columns), [rows, columns]);
  const points = useMemo(() => (geo ? geoPoints(rows, geo, MAX_MAP_POINTS) : []), [rows, geo]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="size-4 animate-spin" />
          Loading dataset…
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-[var(--color-destructive)]">Could not load the dataset: {state.message}</p>
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
    );
  }

  if (!table || rows.length === 0) {
    return <EmptyChart message="This dataset has no rows to visualize." />;
  }

  const count = (kind: string) => columns.filter((c) => c.kind === kind).length;
  const geoLabel = geo ? (geo.combined ?? `${geo.lat} / ${geo.lng}`) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          {tables.length > 1 && (
            <ColumnSelect
              value={table.name}
              options={tables.map((t) => t.name)}
              onChange={setSelectedTable}
              label="Table"
            />
          )}
          <Badge variant="outline">Source: {state.dataset.source.toUpperCase()}</Badge>
          {table.rows.length < table.totalRows && (
            <Badge variant="outline" title="Charts use an evenly spaced sample of the table">
              Sampled {table.rows.length.toLocaleString()} of {table.totalRows.toLocaleString()} rows
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Rows analyzed" value={rows.length.toLocaleString()} />
        <Metric label="Categorical columns" value={count("categorical")} />
        <Metric label="Numeric columns" value={count("numeric")} />
        <Metric label="Mapped points" value={points.length.toLocaleString()} />
      </div>

      <Tabs defaultValue="categorical" className="min-w-0">
        <TabsList>
          <TabsTrigger value="categorical" className="gap-1.5">
            <PieChart className="size-3.5" />
            Categorical
          </TabsTrigger>
          <TabsTrigger value="distributions" className="gap-1.5">
            <BarChart3 className="size-3.5" />
            Distributions
          </TabsTrigger>
          <TabsTrigger value="map" className="gap-1.5">
            <MapPin className="size-3.5" />
            Geospatial Map
          </TabsTrigger>
        </TabsList>

        <TabsContent value="categorical" className="mt-4">
          <CategoricalCharts key={table.name} rows={rows} columns={columns} />
        </TabsContent>

        <TabsContent value="distributions" className="mt-4">
          <DistributionCharts key={table.name} rows={rows} columns={columns} />
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <ChartCard
            title="Geographic distribution"
            description={
              geoLabel ? (
                <span className="inline-flex items-center gap-1">
                  <Sigma className="size-3" />
                  {points.length.toLocaleString()} rows plotted from {geoLabel}
                  {points.length >= MAX_MAP_POINTS && ` (first ${MAX_MAP_POINTS.toLocaleString()})`}
                </span>
              ) : undefined
            }
          >
            {points.length === 0 ? (
              <EmptyChart
                message={
                  geo
                    ? "Coordinate columns were found, but no rows hold valid latitude/longitude values."
                    : "No coordinate columns detected. Name columns lat/latitude and lng/lon/longitude (or a single \"coordinates\" column) to plot rows on the map."
                }
              />
            ) : (
              <GeospatialMap key={table.name} points={points} />
            )}
          </ChartCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
