"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { DatasetRow } from "@/lib/analytics/load-dataset";
import {
  formatNumber,
  histogram,
  isIdLike,
  numericValues,
  scatterPoints,
  summarize,
  type ColumnProfile,
} from "@/lib/analytics/aggregate";
import {
  AXIS_LABEL_STYLE,
  AXIS_TICK,
  ChartCard,
  ColumnSelect,
  EmptyChart,
  GRID_STROKE,
  TOOLTIP_PROPS,
  chartColor,
} from "./chart-theme";

/** Pseudo-column: plots each value against its row position (a strip/dot plot). */
const ROW_INDEX = "Row #";

interface DistributionChartsProps {
  rows: DatasetRow[];
  columns: ColumnProfile[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md bg-[var(--color-muted)] px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default function DistributionCharts({ rows, columns }: DistributionChartsProps) {
  const options = useMemo(() => {
    const numeric = columns.filter((c) => c.kind === "numeric").map((c) => c.name);
    const meaningful = numeric.filter((n) => !isIdLike(n));
    return meaningful.length > 0 ? meaningful : numeric;
  }, [columns]);

  const [histSelected, setHistSelected] = useState("");
  const [xSelected, setXSelected] = useState("");
  const [ySelected, setYSelected] = useState("");

  const histColumn = options.includes(histSelected) ? histSelected : (options[0] ?? "");
  const xOptions = [ROW_INDEX, ...options];
  const xColumn = xOptions.includes(xSelected) ? xSelected : options.length > 1 ? options[0] : ROW_INDEX;
  const yColumn = options.includes(ySelected)
    ? ySelected
    : (options.find((o) => o !== xColumn) ?? options[0] ?? "");

  const values = useMemo(() => (histColumn ? numericValues(rows, histColumn) : []), [rows, histColumn]);
  const bins = useMemo(() => histogram(values), [values]);
  const stats = useMemo(() => summarize(values), [values]);

  const points = useMemo(() => {
    if (!yColumn) return [];
    if (xColumn !== ROW_INDEX) return scatterPoints(rows, xColumn, yColumn);
    const indexed = rows.map((r, i) => ({ ...r, [ROW_INDEX]: i + 1 }));
    return scatterPoints(indexed, ROW_INDEX, yColumn);
  }, [rows, xColumn, yColumn]);

  if (options.length === 0 || rows.length === 0) {
    return (
      <EmptyChart message="No continuous numeric columns found. Columns like salary, age or balance appear here." />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title={`Distribution of ${histColumn}`}
        description={`Histogram · ${bins.length} equal-width bins`}
        action={
          <ColumnSelect value={histColumn} options={options} onChange={setHistSelected} label="Numeric column" />
        }
      >
        {stats && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Min" value={formatNumber(stats.min)} />
            <Stat label="Median" value={formatNumber(stats.median)} />
            <Stat label="Mean" value={formatNumber(stats.mean)} />
            <Stat label="Max" value={formatNumber(stats.max)} />
          </div>
        )}
        {bins.length === 0 ? (
          <EmptyChart message={`${histColumn} has no numeric values.`} />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bins} margin={{ top: 4, right: 8, bottom: 28, left: 8 }} barCategoryGap={1}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  stroke={GRID_STROKE}
                  interval="preserveStartEnd"
                  label={{ value: histColumn, position: "insideBottom", offset: -18, style: AXIS_LABEL_STYLE }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={AXIS_TICK}
                  stroke={GRID_STROKE}
                  width={48}
                  label={{ value: "Frequency", angle: -90, position: "insideLeft", style: AXIS_LABEL_STYLE }}
                />
                <Tooltip
                  {...TOOLTIP_PROPS}
                  formatter={(value: unknown) => [Number(value).toLocaleString(), "Rows"]}
                  labelFormatter={(label: unknown) => `${histColumn}: ${String(label)}`}
                />
                <Bar dataKey="count" name="Rows" fill={chartColor(0)} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      <ChartCard
        title={xColumn === ROW_INDEX ? `Spread of ${yColumn}` : `${yColumn} vs ${xColumn}`}
        description={`Dot plot · ${points.length.toLocaleString()} points`}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <ColumnSelect value={xColumn} options={xOptions} onChange={setXSelected} label="X axis" />
            <ColumnSelect value={yColumn} options={options} onChange={setYSelected} label="Y axis" />
          </div>
        }
      >
        {points.length === 0 ? (
          <EmptyChart message="No rows have numeric values for both selected columns." />
        ) : (
          <div className="h-[22rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, bottom: 28, left: 8 }}>
                <CartesianGrid stroke={GRID_STROKE} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={xColumn}
                  domain={["auto", "auto"]}
                  tick={AXIS_TICK}
                  stroke={GRID_STROKE}
                  tickFormatter={formatNumber}
                  label={{ value: xColumn, position: "insideBottom", offset: -18, style: AXIS_LABEL_STYLE }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={yColumn}
                  domain={["auto", "auto"]}
                  tick={AXIS_TICK}
                  stroke={GRID_STROKE}
                  width={56}
                  tickFormatter={formatNumber}
                  label={{ value: yColumn, angle: -90, position: "insideLeft", style: AXIS_LABEL_STYLE }}
                />
                <ZAxis range={[18, 18]} />
                <Tooltip
                  {...TOOLTIP_PROPS}
                  cursor={{ strokeDasharray: "3 3", stroke: "var(--color-muted-foreground)" }}
                  formatter={(value: unknown) => Number(value).toLocaleString()}
                />
                <Scatter data={points} fill={chartColor(1)} fillOpacity={0.65} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
