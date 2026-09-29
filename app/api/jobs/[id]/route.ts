/**
 * GET    /api/jobs/[id]  – fetch a job with all relations
 * DELETE /api/jobs/[id]  – delete a job record and its files in the storage bucket
 *
 * Status/progress are written only by the BullMQ worker (processJob) via
 * GenerationJobService — there is intentionally no client-facing PATCH.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import {
  deleteJob,
  getJobWithRelations,
  withFreshExportUrl,
} from "@/lib/db/services/generation-job-service";
import { validateObjectId } from "@/lib/utils/validate-object-id";

type Params = { params: Promise<{ id: string }> };

async function resolveAndAuthorize(jobId: string, userId: string) {
  const job = await getJobWithRelations(jobId);
  if (!job) return null;
  const workspace = await getWorkspace(job.workspaceId);
  if (!workspace || workspace.userId !== userId) return "forbidden";
  return job;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const invalidId = validateObjectId(id);
  if (invalidId) return invalidId;
  const result = await resolveAndAuthorize(id, session.user.id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(await withFreshExportUrl(result));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const invalidId = validateObjectId(id);
  if (invalidId) return invalidId;
  const check = await resolveAndAuthorize(id, session.user.id);
  if (!check) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (check === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await deleteJob(id);
  return new NextResponse(null, { status: 204 });
}
