"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DatasetRow } from "@/lib/analytics/load-dataset";
import { frequencies, type ColumnProfile } from "@/lib/analytics/aggregate";
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

interface CategoricalChartsProps {
  rows: DatasetRow[];
  columns: ColumnProfile[];
}

function truncate(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export default function CategoricalCharts({ rows, columns }: CategoricalChartsProps) {
  const options = useMemo(
    () => columns.filter((c) => c.kind === "categorical").map((c) => c.name),
    [columns]
  );
  const [selected, setSelected] = useState("");
  const column = options.includes(selected) ? selected : (options[0] ?? "");

  const buckets = useMemo(() => (column ? frequencies(rows, column) : []), [rows, column]);
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  if (options.length === 0 || rows.length === 0) {
    return (
      <EmptyChart message="No categorical columns found. Columns with a small set of repeated values (status, department, country…) appear here." />
    );
  }

  const picker = (
    <ColumnSelect value={column} options={options} onChange={setSelected} label="Category column" />
  );
  const tooltip = {
    ...TOOLTIP_PROPS,
    formatter: (value: unknown) => {
      const n = Number(value);
      return [`${n.toLocaleString()} (${total ? ((n / total) * 100).toFixed(1) : 0}%)`, "Rows"];
    },
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title={`Rows by ${column}`}
        description={`Frequency of each value · ${buckets.length} groups`}
        action={picker}
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} layout="vertical" margin={{ top: 4, right: 16, bottom: 20, left: 8 }}>
              <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={AXIS_TICK}
                stroke={GRID_STROKE}
                label={{ value: "Row count", position: "insideBottom", offset: -12, style: AXIS_LABEL_STYLE }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tick={AXIS_TICK}
                stroke={GRID_STROKE}
                tickFormatter={(v: string) => truncate(v)}
              />
              <Tooltip {...tooltip} />
              <Bar dataKey="count" name="Rows" radius={[0, 4, 4, 0]} maxBarSize={28}>
                {buckets.map((b, i) => (
                  <Cell key={b.label} fill={chartColor(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={`Share of ${column}`} description={`${total.toLocaleString()} rows analyzed`}>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={buckets}
                dataKey="count"
                nameKey="label"
                innerRadius="52%"
                outerRadius="80%"
                paddingAngle={1}
                stroke="var(--color-card)"
                strokeWidth={2}
              >
                {buckets.map((b, i) => (
                  <Cell key={b.label} fill={chartColor(i)} />
                ))}
              </Pie>
              <Tooltip {...tooltip} cursor={false} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                formatter={(value: string) => (
                  <span className="text-xs text-[var(--color-muted-foreground)]">{truncate(value, 20)}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}
