/**
 * GET  /api/jobs?workspaceId=  – list generation jobs (with optional filters)
 * POST /api/jobs               – create a new generation job
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import { createJob, listJobs } from "@/lib/db/services/generation-job-service";
import { JobStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const workspaceId = searchParams.get("workspaceId") ?? undefined;
  const schemaId = searchParams.get("schemaId") ?? undefined;
  const page = searchParams.get("page") ? Number(searchParams.get("page")) : undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const rawStatuses = searchParams.getAll("status");
  const validStatuses = rawStatuses.filter((s): s is JobStatus =>
    Object.values(JobStatus).includes(s as JobStatus)
  );

  // If workspaceId provided, verify ownership
  if (workspaceId) {
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (workspace.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const result = await listJobs(
    {
      workspaceId,
      schemaId,
      status: validStatuses.length ? validStatuses : undefined,
    },
    { page, limit }
  );

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspaceId, schemaId, rowCount, seed, locale } = body as {
    workspaceId?: string;
    schemaId?: string;
    rowCount?: number;
    seed?: number;
    locale?: string;
  };

  if (!workspaceId || typeof workspaceId !== "string") {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!schemaId || typeof schemaId !== "string") {
    return NextResponse.json({ error: "schemaId is required" }, { status: 400 });
  }

  // Verify ownership
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await createJob({
    workspace: { connect: { id: workspaceId } },
    schema: { connect: { id: schemaId } },
    ...(rowCount !== undefined && { rowCount }),
    ...(seed !== undefined && { seed }),
    ...(locale !== undefined && { locale }),
  });

  return NextResponse.json(job, { status: 201 });
}
