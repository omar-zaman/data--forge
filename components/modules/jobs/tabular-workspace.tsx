"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import SchemaDesigner from "@/components/modules/schema/schema-designer";
import SchemaPicker, {
  groupSchemas,
  type SchemaSummary,
} from "@/components/modules/schema/schema-picker";
import SchemaVersionControls from "@/components/modules/schema/schema-version-controls";
import JobHistoryTable, { useWorkspaceJobs } from "./job-history-table";
import RunGenerationModal from "./run-generation-modal";

interface TabularWorkspaceProps {
  workspaceId: string;
  initialSchemas: SchemaSummary[];
}

function toSummary(raw: SchemaSummary): SchemaSummary {
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    dataType: raw.dataType,
    tables: Array.isArray(raw.tables) ? raw.tables : [],
  };
}

/**
 * Client shell for the Tabular tab: owns the workspace's schema list and the
 * schema open in the designer, and shares job state between the
 * "Generate Data" modal and the Job History table.
 */
export default function TabularWorkspace({
  workspaceId,
  initialSchemas,
}: TabularWorkspaceProps) {
  const [schemas, setSchemas] = useState<SchemaSummary[]>(initialSchemas);
  const groups = useMemo(() => groupSchemas(schemas), [schemas]);

  // null = an unsaved draft is open in the designer
  const [activeSchemaId, setActiveSchemaId] = useState<string | null>(
    () => groupSchemas(initialSchemas)[0]?.versions[0]?.id ?? null
  );
  // Bumped whenever a different schema is opened so the designer re-seeds
  // its local state; a save keeps the key so edits aren't discarded.
  const [designerKey, setDesignerKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { jobs, isLoading, loadError, reload, upsertJob } =
    useWorkspaceJobs(workspaceId);

  const activeSchema = schemas.find((s) => s.id === activeSchemaId) ?? null;
  const activeGroup = activeSchema
    ? groups.find((g) => g.name === activeSchema.name) ?? null
    : null;

  const refreshSchemas = useCallback(async (): Promise<SchemaSummary[] | null> => {
    setIsRefreshing(true);
    try {
      const res = await fetch(
        `/api/schemas?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = ((await res.json()) as SchemaSummary[]).map(toSummary);
      setSchemas(next);
      return next;
    } catch (err) {
      toast.error("Could not load schemas", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      return null;
    } finally {
      setIsRefreshing(false);
    }
  }, [workspaceId]);

  function openSchema(schemaId: string | null) {
    setActiveSchemaId(schemaId);
    setDesignerKey((k) => k + 1);
  }

  function handleSelect(schemaId: string) {
    if (schemaId !== activeSchemaId) openSchema(schemaId);
  }

  function handleSchemaSaved(schemaId: string) {
    setActiveSchemaId(schemaId);
    void refreshSchemas();
  }

  async function handleVersionCreated(schemaId: string) {
    await refreshSchemas();
    openSchema(schemaId);
  }

  async function handleDeleted(schemaId: string) {
    const deletedName = schemas.find((s) => s.id === schemaId)?.name;
    const next = (await refreshSchemas()) ?? schemas.filter((s) => s.id !== schemaId);
    const nextGroups = groupSchemas(next);
    // Prefer the newest remaining version of the same schema, else the first schema
    const fallback =
      nextGroups.find((g) => g.name === deletedName) ?? nextGroups[0];
    openSchema(fallback?.versions[0]?.id ?? null);
    // Jobs of the deleted schema were removed with it
    void reload();
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <SchemaPicker
            groups={groups}
            activeSchemaId={activeSchemaId}
            isLoading={isRefreshing}
            onSelect={handleSelect}
            onCreate={() => openSchema(null)}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          {activeSchema && activeGroup && (
            <SchemaVersionControls
              workspaceId={workspaceId}
              group={activeGroup}
              activeSchemaId={activeSchema.id}
              onSelectVersion={handleSelect}
              onVersionCreated={handleVersionCreated}
              onDeleted={handleDeleted}
            />
          )}

          <SchemaDesigner
            key={designerKey}
            workspaceId={workspaceId}
            initialSchema={activeSchema}
            onSchemaSaved={handleSchemaSaved}
            actions={
              <RunGenerationModal
                workspaceId={workspaceId}
                schemaId={activeSchemaId}
                onJobCreated={upsertJob}
              />
            }
          />
        </div>
      </div>

      <JobHistoryTable
        jobs={jobs}
        isLoading={isLoading}
        loadError={loadError}
        onReload={() => reload()}
        onJobUpdate={upsertJob}
      />
    </div>
  );
}
