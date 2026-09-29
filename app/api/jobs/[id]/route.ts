/**
 * GET    /api/jobs/[id]  – fetch a job with all relations
 * PATCH  /api/jobs/[id]  – update job status / progress
 * DELETE /api/jobs/[id]  – delete a job record
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import {
  getJobWithRelations,
  updateJobStatus,
} from "@/lib/db/services/generation-job-service";
import prisma from "@/lib/db/prisma";
import { JobStatus } from "@prisma/client";

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
  const result = await resolveAndAuthorize(id, session.user.id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const check = await resolveAndAuthorize(id, session.user.id);
  if (!check) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (check === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    status?: string;
    progress?: number;
  };

  if (!body.status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }
  if (!Object.values(JobStatus).includes(body.status as JobStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${Object.values(JobStatus).join(", ")}` },
      { status: 400 }
    );
  }

  const updated = await updateJobStatus(
    id,
    body.status as JobStatus,
    body.progress
  );
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const check = await resolveAndAuthorize(id, session.user.id);
  if (!check) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (check === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.generationJob.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
