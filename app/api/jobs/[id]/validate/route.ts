/**
 * POST /api/jobs/[id]/validate  – trigger validation phase for a job
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import {
  getJob,
  validateJob,
  getJobValidation,
} from "@/lib/db/services/generation-job-service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const workspace = await getWorkspace(job.workspaceId);
  if (!workspace || workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updatedJob = await validateJob(id);
  const validationResult = await getJobValidation(id);

  return NextResponse.json({ job: updatedJob, validation: validationResult });
}
