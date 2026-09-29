import { Suspense } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceWithRelations } from "@/types/database";

// Forward-declared import — SchemaDesigner is created in task 3.1
import SchemaDesigner from "@/components/modules/schema/schema-designer";

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

  // Forward session cookie so the API can authenticate the request
  const cookieHeader = (await headers()).get("cookie") ?? "";

  const baseUrl =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  const res = await fetch(`${baseUrl}/api/workspaces/${id}`, {
    headers: { cookie: cookieHeader },
    // Always re-fetch on each request — workspace data changes over time
    cache: "no-store",
  });

  if (res.status === 404 || res.status === 403 || res.status === 401) {
    notFound();
  }

  if (!res.ok) {
    // Unexpected server error — still show 404 to the user
    notFound();
  }

  const workspace: WorkspaceWithRelations = await res.json();

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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            {workspace.name}
          </h1>
          {workspace.description && (
            <p className="mt-1.5 text-slate-500 dark:text-slate-400 text-sm">
              {workspace.description}
            </p>
          )}
        </div>

        {/* Tabbed navigation */}
        <Tabs defaultValue="tabular">
          <TabsList className="mb-6">
            <TabsTrigger value="tabular">Tabular</TabsTrigger>
            <TabsTrigger value="relational">Relational</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          {/* Tabular tab — hosts the schema designer */}
          <TabsContent value="tabular">
            <Suspense fallback={<SchemaDesignerSkeleton />}>
              <SchemaDesigner workspaceId={id} />
            </Suspense>
          </TabsContent>

          {/* Relational tab — coming soon */}
          <TabsContent value="relational">
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Relational Designer
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Coming Soon
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents tab — coming soon */}
          <TabsContent value="documents">
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Document Designer
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Coming Soon
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
