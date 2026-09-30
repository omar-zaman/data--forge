/**
 * GET  /api/jobs/[id]/download?format=zip|csv|json|sql|pdf[&inline=1]
 *   – streams one of a completed job's exports through the app as an attachment,
 *     byte-for-byte as stored: zip (CSV + JSON per table and the SQL dump),
 *     csv (single-table jobs), sql (schema + data dump) or pdf (document jobs).
 *     Serving it same-origin means the browser never needs to reach the bucket.
 *     `inline=1` (PDF only) serves it for in-browser preview instead of download.
 * HEAD /api/jobs/[id]/download?format=…
 *   – the same checks without the body, so the UI can surface errors as toasts
 *     before handing the download to the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { JobStatus } from "@prisma/client";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import { getJob } from "@/lib/db/services/generation-job-service";
import {
  CONTENT_TYPES,
  EXPORT_FILE_FORMATS,
  findJobExport,
  type ExportFileFormat,
} from "@/lib/engine/exporter";
import { getObjectStream } from "@/lib/storage/s3";
import { validateObjectId } from "@/lib/utils/validate-object-id";

type Params = { params: Promise<{ id: string }> };

const FORMATS = EXPORT_FILE_FORMATS;

/** RFC 6266 header with an ASCII fallback and the UTF-8 name. */
function contentDisposition(fileName: string, inline = false): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

type Resolved =
  | { error: NextResponse }
  | { format: ExportFileFormat; export: { key: string; fileName: string; sizeBytes?: number } };

async function resolveExport(req: NextRequest, { params }: Params): Promise<Resolved> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { id } = await params;
  const invalidId = validateObjectId(id);
  if (invalidId) return { error: invalidId };

  const format = req.nextUrl.searchParams.get("format") as ExportFileFormat | null;
  if (!format || !FORMATS.includes(format)) {
    return {
      error: NextResponse.json(
        { error: `format must be one of: ${FORMATS.join(", ")}` },
        { status: 400 }
      ),
    };
  }

  const job = await getJob(id);
  if (!job) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const workspace = await getWorkspace(job.workspaceId);
  if (!workspace || workspace.userId !== session.user.id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (job.status !== JobStatus.COMPLETED) {
    return {
      error: NextResponse.json({ error: "The job has not finished yet" }, { status: 409 }),
    };
  }

  try {
    const found = await findJobExport(job.workspaceId, job.id, format);
    if (!found) {
      return {
        error: NextResponse.json(
          { error: `No ${format.toUpperCase()} export is available for this job` },
          { status: 404 }
        ),
      };
    }
    return { format, export: found };
  } catch (error) {
    console.error(`[jobs] Failed to resolve ${format} download for job ${id}:`, error);
    return { error: storageUnavailable() };
  }
}

function storageUnavailable(): NextResponse {
  return NextResponse.json(
    { error: "Export storage is unavailable. Please try again shortly." },
    { status: 503 }
  );
}

/** Only PDFs are ever rendered inline (the browser's own PDF viewer). */
function isInline(req: NextRequest, format: ExportFileFormat): boolean {
  return format === "pdf" && req.nextUrl.searchParams.get("inline") === "1";
}

function fileHeaders(
  format: ExportFileFormat,
  fileName: string,
  size?: number,
  inline = false
): HeadersInit {
  return {
    "Content-Type": CONTENT_TYPES[format],
    "Content-Disposition": contentDisposition(fileName, inline),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...(size !== undefined && { "Content-Length": String(size) }),
  };
}

export async function HEAD(req: NextRequest, ctx: Params) {
  const resolved = await resolveExport(req, ctx);
  if ("error" in resolved) return new NextResponse(null, { status: resolved.error.status });
  const { format, export: file } = resolved;
  return new NextResponse(null, {
    headers: fileHeaders(format, file.fileName, file.sizeBytes, isInline(req, format)),
  });
}

export async function GET(req: NextRequest, ctx: Params) {
  const resolved = await resolveExport(req, ctx);
  if ("error" in resolved) return resolved.error;
  const { format, export: file } = resolved;

  try {
    const object = await getObjectStream(file.key);
    return new NextResponse(object.body, {
      headers: fileHeaders(
        format,
        file.fileName,
        object.contentLength ?? file.sizeBytes,
        isInline(req, format)
      ),
    });
  } catch (error) {
    console.error(`[jobs] Failed to stream ${format} export ${file.key}:`, error);
    return storageUnavailable();
  }
}
