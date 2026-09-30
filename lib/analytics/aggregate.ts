/**
 * Client-safe helpers that turn raw dataset rows into chart-ready shapes:
 * column profiling, categorical frequencies, histogram bins, scatter points
 * and geographic coordinates. Loops avoid Math.min(...values) so large
 * columns can never overflow the call stack.
 */

import type { DatasetRow, DatasetValue } from "@/lib/analytics/load-dataset";

export type ColumnKind = "numeric" | "categorical" | "text";

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  nonNull: number;
  distinct: number;
}

/** Categorical columns have few distinct values relative to row count. */
const MAX_CATEGORIES = 50;

function isNumber(v: DatasetValue): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function profileColumns(rows: DatasetRow[]): ColumnProfile[] {
  const names = new Set<string>();
  for (const row of rows.slice(0, 200)) for (const key of Object.keys(row)) names.add(key);

  return [...names].map((name) => {
    let nonNull = 0;
    let numeric = 0;
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row[name];
      if (v === null || v === undefined || v === "") continue;
      nonNull++;
      if (isNumber(v)) numeric++;
      if (seen.size <= MAX_CATEGORIES) seen.add(String(v));
    }

    const distinct = seen.size;
    const lowCardinality = distinct <= MAX_CATEGORIES && distinct <= Math.max(2, nonNull * 0.5);
    let kind: ColumnKind = "text";
    // Numeric columns with only a handful of codes (e.g. 1–5 ratings) read better as categories
    if (nonNull > 0 && numeric === nonNull) kind = distinct <= 10 && lowCardinality ? "categorical" : "numeric";
    else if (nonNull > 0 && lowCardinality) kind = "categorical";
    return { name, kind, nonNull, distinct };
  });
}

/** Numeric columns that are identifiers or coordinates make poor distributions. */
export function isIdLike(name: string): boolean {
  return /(^id$|_id$|Id$|^uuid$)/.test(name);
}

// ============================================
// Categorical frequencies
// ============================================

export interface FrequencyBucket {
  label: string;
  count: number;
}

/** Counts per value, largest first; the tail beyond `topN` folds into "Other". */
export function frequencies(rows: DatasetRow[], column: string, topN = 10): FrequencyBucket[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = row[column];
    const label = v === null || v === undefined || v === "" ? "(empty)" : String(v);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  if (sorted.length <= topN + 1) return sorted;
  const other = sorted.slice(topN).reduce((sum, b) => sum + b.count, 0);
  return [...sorted.slice(0, topN), { label: "Other", count: other }];
}

// ============================================
// Numeric distributions
// ============================================

export function numericValues(rows: DatasetRow[], column: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = row[column];
    if (isNumber(v)) out.push(v);
  }
  return out;
}

export interface NumericSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
}

export function summarize(values: number[]): NumericSummary | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count: values.length, min, max, mean: sum / values.length, median };
}

export interface HistogramBin {
  /** Short range label for the axis. */
  label: string;
  start: number;
  end: number;
  count: number;
}

export function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(abs < 1 ? 2 : 1);
}

/**
 * Equal-width bins. Bin count follows Sturges' rule (clamped to 5–30), capped
 * by the number of distinct integers for integer data so bins never split a
 * single value. The last bin is closed so the maximum is counted.
 */
export function histogram(values: number[], requestedBins?: number): HistogramBin[] {
  const stats = summarize(values);
  if (!stats) return [];
  const { min, max } = stats;

  if (min === max) {
    return [{ label: formatNumber(min), start: min, end: max, count: values.length }];
  }

  let bins = requestedBins ?? Math.ceil(Math.log2(values.length) + 1);
  bins = Math.min(30, Math.max(5, bins));
  if (values.every(Number.isInteger)) bins = Math.min(bins, max - min + 1);

  const width = (max - min) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => {
    const start = min + i * width;
    const end = i === bins - 1 ? max : min + (i + 1) * width;
    return { label: `${formatNumber(start)}–${formatNumber(end)}`, start, end, count: 0 };
  });
  for (const v of values) {
    const index = Math.min(bins - 1, Math.floor((v - min) / width));
    out[index].count++;
  }
  return out;
}

export interface ScatterPoint {
  x: number;
  y: number;
}

/** Paired numeric values; rows missing either side are skipped. */
export function scatterPoints(
  rows: DatasetRow[],
  xColumn: string,
  yColumn: string,
  limit = 2000
): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  const stride = Math.max(1, rows.length / limit);
  for (let i = 0; i < rows.length && points.length < limit; i += stride) {
    const row = rows[Math.floor(i)];
    const x = row[xColumn];
    const y = row[yColumn];
    if (isNumber(x) && isNumber(y)) points.push({ x, y });
  }
  return points;
}

// ============================================
// Geospatial
// ============================================

export interface GeoColumns {
  /** Separate latitude/longitude columns. */
  lat?: string;
  lng?: string;
  /** One column holding "lat, lng" or [lat, lng]. */
  combined?: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  row: DatasetRow;
}

const LAT_NAME = /^(lat|latitude)$|(_|\b)lat(itude)?$/i;
const LNG_NAME = /^(lng|lon|long|longitude)$|(_|\b)(lng|lon|long|longitude)$/i;
const COMBINED_NAME = /^(coordinates?|coords?|geo|location|lat_?lng|latlng|position)$/i;

function parseCombined(v: DatasetValue): [number, number] | null {
  if (typeof v !== "string") return null;
  const m = /^\s*\[?\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*\]?\s*$/.exec(v);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function validLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

export function detectGeoColumns(rows: DatasetRow[], columns: ColumnProfile[]): GeoColumns | null {
  const numeric = columns.filter((c) => c.kind === "numeric" || c.kind === "categorical");
  const lat = numeric.find((c) => LAT_NAME.test(c.name))?.name;
  const lng = numeric.find((c) => LNG_NAME.test(c.name))?.name;
  if (lat && lng) return { lat, lng };

  const combined = columns.find(
    (c) => COMBINED_NAME.test(c.name) && rows.slice(0, 20).some((r) => parseCombined(r[c.name]))
  );
  return combined ? { combined: combined.name } : null;
}

export function geoPoints(rows: DatasetRow[], geo: GeoColumns, limit = 1000): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const row of rows) {
    if (points.length >= limit) break;
    let pair: [number, number] | null = null;
    if (geo.combined) pair = parseCombined(row[geo.combined]);
    else if (geo.lat && geo.lng) {
      const lat = row[geo.lat];
      const lng = row[geo.lng];
      if (isNumber(lat) && isNumber(lng)) pair = [lat, lng];
    }
    if (pair && validLatLng(pair[0], pair[1])) points.push({ lat: pair[0], lng: pair[1], row });
  }
  return points;
}
