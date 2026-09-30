/**
 * GET /api/jobs/[id]/analytics
 *   – returns a completed job's generated rows (per table, down-sampled to
 *     MAX_ROWS_PER_TABLE) for the client-side analytics dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { JobStatus } from "@prisma/client";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import { getJob } from "@/lib/db/services/generation-job-service";
import { DatasetTooLargeError, loadJobDataset } from "@/lib/analytics/load-dataset";
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

  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const workspace = await getWorkspace(job.workspaceId);
  if (!workspace || workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.status !== JobStatus.COMPLETED) {
    return NextResponse.json({ error: "The job has not finished yet" }, { status: 409 });
  }

  try {
    const dataset = await loadJobDataset(job.workspaceId, job.id);
    if (!dataset) {
      return NextResponse.json(
        { error: "This job has no tabular dataset to analyze" },
        { status: 404 }
      );
    }
    return NextResponse.json(dataset, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DatasetTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error(`[jobs] Failed to load analytics dataset for job ${id}:`, error);
    return NextResponse.json(
      { error: "Export storage is unavailable. Please try again shortly." },
      { status: 503 }
    );
  }
}
