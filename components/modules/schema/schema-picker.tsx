"use client";

import { Database, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TableStructure } from "@/types/database";

/** Serializable schema definition as returned by GET /api/schemas. */
export interface SchemaSummary {
  id: string;
  name: string;
  version: number;
  dataType?: string;
  tables: TableStructure[];
}

/** All versions of one schema name, newest first. */
export interface SchemaGroup {
  name: string;
  versions: SchemaSummary[];
}

/** Groups schemas by name (versions share a name), newest version first. */
export function groupSchemas(schemas: SchemaSummary[]): SchemaGroup[] {
  const groups = new Map<string, SchemaSummary[]>();
  for (const schema of schemas) {
    const list = groups.get(schema.name) ?? [];
    list.push(schema);
    groups.set(schema.name, list);
  }
  return [...groups.entries()]
    .map(([name, versions]) => ({
      name,
      versions: versions.sort((a, b) => b.version - a.version),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface SchemaPickerProps {
  groups: SchemaGroup[];
  /** Id of the schema version open in the designer; null for an unsaved draft. */
  activeSchemaId: string | null;
  isLoading?: boolean;
  onSelect: (schemaId: string) => void;
  onCreate: () => void;
}

/**
 * Sidebar listing every schema in the workspace. Selecting an entry opens its
 * latest version; the entry owning the active version is highlighted.
 */
export default function SchemaPicker({
  groups,
  activeSchemaId,
  isLoading = false,
  onSelect,
  onCreate,
}: SchemaPickerProps) {
  const isDraft = activeSchemaId === null;

  return (
    <nav aria-label="Schemas" className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          Schemas
        </span>
        {isLoading && (
          <Loader2 className="size-3.5 animate-spin text-[var(--color-muted-foreground)]" />
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {groups.map((group) => {
          const latest = group.versions[0];
          const isActive = group.versions.some((v) => v.id === activeSchemaId);
          return (
            <li key={group.name}>
              <button
                type="button"
                onClick={() => onSelect(latest.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  isActive
                    ? "border-[var(--color-primary)] bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
                    : "border-transparent text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]"
                )}
              >
                <Database className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <Badge variant={isActive ? "outline" : "muted"} className="shrink-0">
                  v{latest.version}
                </Badge>
              </button>
            </li>
          );
        })}

        {/* Unsaved draft — highlighted until its first save */}
        {isDraft && (
          <li>
            <div className="flex items-center gap-2 rounded-md border border-dashed border-[var(--color-primary)] bg-[var(--color-accent)] px-3 py-2 text-sm font-medium">
              <Database className="size-4 shrink-0" />
              <span className="flex-1 italic">Unsaved schema</span>
            </div>
          </li>
        )}
      </ul>

      <Button
        variant="outline"
        size="sm"
        onClick={onCreate}
        disabled={isDraft}
        className="mt-1"
      >
        <Plus />
        New Schema
      </Button>
    </nav>
  );
}
