/**
 * GET /api/jobs/[id]/validate  – the job's health report (latest ValidationResult)
 *
 * Validation runs inside the worker while rows are generated (lib/engine/auditor.ts),
 * so there is nothing to trigger here; the report is returned once it's recorded.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import { getJob, getJobValidation } from "@/lib/db/services/generation-job-service";
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

  const validation = await getJobValidation(id);
  if (!validation) {
    return NextResponse.json(
      { error: "No health report has been recorded for this job" },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      jobId: id,
      healthCheckPassed: job.healthCheckPassed,
      isPassed: validation.isPassed,
      summary: validation.summary,
      issues: validation.errors,
      createdAt: validation.createdAt,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
