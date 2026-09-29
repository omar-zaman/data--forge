import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUserId } from "@/lib/auth/session";
import { getWorkspaceById } from "@/lib/db/services/workspace-service";
import { parseTables } from "@/lib/db/services/schema-definition-service";
import type { SchemaSummary } from "@/components/modules/schema/schema-picker";
import TabularWorkspace from "@/components/modules/jobs/tabular-workspace";
import WorkspaceSettings from "@/components/modules/workspace/workspace-settings";
import DocumentWorkspace from "@/components/modules/documents/document-workspace";
import { listTemplatesForUser } from "@/lib/db/services/visual-template-service";

export const metadata = {
  title: "Workspace | DataForge",
};

// ---------------------------------------------------------------------------
// Skeleton shown inside <Suspense> while SchemaDesigner loads
// ---------------------------------------------------------------------------

function SchemaDesignerSkeleton() {
  return (
    <div className="space-y-4 p-1">
      {/* Schema name input row */}
      <Skeleton className="h-9 w-72 rounded-md" />

      {/* Three column rows approximating the designer layout */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-40 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-5 w-10 rounded-full" />
          <Skeleton className="h-5 w-10 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WorkspacePage({ params }: PageProps) {
  const { id } = await params;

  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/login");
  }

  // Ownership is enforced inside the query — another user's workspace
  // resolves to null exactly like a missing one (no IDOR, no existence leak)
  const workspace = await getWorkspaceById(id, userId);
  if (!workspace) {
    notFound();
  }

  // Hand the client only plain, serializable fields of every schema version
  const initialSchemas: SchemaSummary[] = workspace.schemaDefinitions.map(
    (schema) => ({
      id: schema.id,
      name: schema.name,
      version: schema.version,
      dataType: schema.dataType,
      tables: parseTables(schema.tables),
    })
  );

  // Own + public templates for the Documents tab's visual picker
  const { own, shared } = await listTemplatesForUser(userId);
  const templates = [...own, ...shared];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8">

        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        {/* Workspace header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50 break-words">
              {workspace.name}
            </h1>
            {workspace.description && (
              <p className="mt-1.5 text-slate-500 dark:text-slate-400 text-sm">
                {workspace.description}
              </p>
            )}
          </div>
          <WorkspaceSettings
            workspaceId={workspace.id}
            name={workspace.name}
            description={workspace.description}
          />
        </div>

        {/* Tabbed navigation */}
        <Tabs defaultValue="schema-designer">
          <TabsList className="mb-6">
            <TabsTrigger value="schema-designer">Schema Designer</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          {/* Schema Designer — single- and multi-table (relational) schemas,
              generation and job history */}
          <TabsContent value="schema-designer">
            <Suspense fallback={<SchemaDesignerSkeleton />}>
              <TabularWorkspace
                workspaceId={workspace.id}
                initialSchemas={initialSchemas}
              />
            </Suspense>
          </TabsContent>

          {/* Documents — map a relational schema onto a visual template, render PDFs */}
          <TabsContent value="documents">
            <DocumentWorkspace
              workspaceId={workspace.id}
              initialSchemas={initialSchemas}
              templates={templates}
            />
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
