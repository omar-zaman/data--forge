/**
 * PATCH /api/jobs/[id]/progress  – update the progress percentage of a job
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import {
  getJob,
  updateJobStatus,
} from "@/lib/db/services/generation-job-service";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
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

  const body = await req.json().catch(() => ({})) as { progress?: number };
  const progress = Number(body.progress);

  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    return NextResponse.json(
      { error: "progress must be an integer between 0 and 100" },
      { status: 400 }
    );
  }

  const updated = await updateJobStatus(id, job.status, progress);
  return NextResponse.json(updated);
}
