/**
 * GET /api/jobs/[id]/download?format=zip|csv|sql|pdf
 *   – returns a fresh 24-hour presigned URL for one of a completed job's exports:
 *     zip (CSV + JSON per table and the SQL dump), csv (single-table jobs),
 *     sql (schema + data dump) or pdf (document jobs)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { JobStatus } from "@prisma/client";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import { getJob } from "@/lib/db/services/generation-job-service";
import { getJobExportDownload, type ExportFileFormat } from "@/lib/engine/exporter";
import { validateObjectId } from "@/lib/utils/validate-object-id";

type Params = { params: Promise<{ id: string }> };

const FORMATS: ExportFileFormat[] = ["zip", "csv", "sql", "pdf"];

export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const invalidId = validateObjectId(id);
  if (invalidId) return invalidId;

  const format = req.nextUrl.searchParams.get("format") as ExportFileFormat | null;
  if (!format || !FORMATS.includes(format)) {
    return NextResponse.json(
      { error: `format must be one of: ${FORMATS.join(", ")}` },
      { status: 400 }
    );
  }

  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const workspace = await getWorkspace(job.workspaceId);
  if (!workspace || workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.status !== JobStatus.COMPLETED) {
    return NextResponse.json(
      { error: "The job has not finished yet" },
      { status: 409 }
    );
  }

  try {
    const download = await getJobExportDownload(job.workspaceId, job.id, format);
    if (!download) {
      return NextResponse.json(
        { error: `No ${format.toUpperCase()} export is available for this job` },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { format, ...download },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(`[jobs] Failed to resolve ${format} download for job ${id}:`, error);
    return NextResponse.json(
      { error: "Export storage is unavailable. Please try again shortly." },
      { status: 503 }
    );
  }
}
