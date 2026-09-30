"use client";

/**
 * Leaflet map of a dataset's coordinate rows. Touches `window`, so it must be
 * loaded with next/dynamic and `ssr: false` (see analytics-dashboard.tsx).
 */

import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { GeoPoint } from "@/lib/analytics/aggregate";

const POPUP_FIELDS = 10;

type ImageImport = string | { src: string };
const assetUrl = (img: ImageImport) => (typeof img === "string" ? img : img.src);

/** Leaflet derives marker URLs from its CSS path, which bundlers break. */
function fixDefaultIcons() {
  delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: assetUrl(markerIcon),
    iconRetinaUrl: assetUrl(markerIcon2x),
    shadowUrl: assetUrl(markerShadow),
  });
}

function FitBounds({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
  }, [map, points]);
  return null;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return String(value);
}

export default function GeospatialMap({ points }: { points: GeoPoint[] }) {
  const [iconsReady, setIconsReady] = useState(false);

  useEffect(() => {
    fixDefaultIcons();
    // Markers mount only after the patched icon URLs are in place
    const frame = requestAnimationFrame(() => setIconsReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <MapContainer
      center={points[0] ? [points[0].lat, points[0].lng] : [20, 0]}
      zoom={3}
      scrollWheelZoom
      className="h-[28rem] w-full rounded-lg border border-[var(--color-border)]"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {iconsReady &&
        points.map((p, i) => {
          const entries = Object.entries(p.row);
          return (
            <Marker key={i} position={[p.lat, p.lng]}>
              <Popup>
                <dl className="grid max-w-64 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {entries.slice(0, POPUP_FIELDS).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-medium text-[var(--color-muted-foreground)]">{k}</dt>
                      <dd className="m-0 truncate" title={formatCell(v)}>
                        {formatCell(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {entries.length > POPUP_FIELDS && (
                  <p className="!mb-0 !mt-1 text-[11px] text-[var(--color-muted-foreground)]">
                    +{entries.length - POPUP_FIELDS} more fields
                  </p>
                )}
              </Popup>
            </Marker>
          );
        })}
    </MapContainer>
  );
}
