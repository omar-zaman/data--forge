"use client";

import type { CSSProperties, ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** OKLCH tokens from globals.css — they switch with the color scheme. */
export const CHART_COLORS = Array.from({ length: 8 }, (_, i) => `var(--color-chart-${i + 1})`);

export const chartColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];

export const AXIS_TICK = { fill: "var(--color-muted-foreground)", fontSize: 12 };
export const AXIS_LABEL_STYLE: CSSProperties = { fill: "var(--color-muted-foreground)", fontSize: 12 };
export const GRID_STROKE = "var(--color-chart-grid)";

export const TOOLTIP_PROPS = {
  contentStyle: {
    background: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    color: "var(--color-popover-foreground)",
    fontSize: 12,
  } satisfies CSSProperties,
  labelStyle: { color: "var(--color-popover-foreground)", fontWeight: 600 } satisfies CSSProperties,
  itemStyle: { color: "var(--color-popover-foreground)" } satisfies CSSProperties,
  cursor: { fill: "var(--color-muted)", opacity: 0.6 },
};

export function ChartCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-4 pt-0">{children}</CardContent>
    </Card>
  );
}

export function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] px-6 text-center text-sm text-[var(--color-muted-foreground)]">
      {message}
    </div>
  );
}

export function ColumnSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-44 text-xs" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="text-xs">
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
