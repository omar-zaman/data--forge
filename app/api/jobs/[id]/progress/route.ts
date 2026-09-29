/**
 * GET   /api/jobs/[id]/progress  – current status/progress of a job (read fresh from the DB)
 *
 * Progress is written only by the BullMQ worker (processJob) via
 * GenerationJobService — there is intentionally no client-facing PATCH.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import { getJob, withFreshExportUrl } from "@/lib/db/services/generation-job-service";
import { validateObjectId } from "@/lib/utils/validate-object-id";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const invalidId = validateObjectId(id);
  if (invalidId) return invalidId;
  const found = await getJob(id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const workspace = await getWorkspace(found.workspaceId);
  if (!workspace || workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const job = await withFreshExportUrl(found);

  return NextResponse.json(
    {
      id: job.id,
      status: job.status,
      progress: job.progress,
      exportUrl: job.exportUrl,
      fileSizeBytes: job.fileSizeBytes,
      validationErrors: job.validationErrors,
      completedAt: job.completedAt,
      updatedAt: job.updatedAt,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
