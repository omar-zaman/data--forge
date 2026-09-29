/**
 * GET  /api/jobs?workspaceId=  – list generation jobs for a workspace the caller owns
 *                                (workspaceId is required; optional filters)
 * POST /api/jobs               – create a new generation job and add it to the BullMQ
 *                                queue (response returns immediately). With
 *                                `document: { templateId, mapping }` the worker
 *                                renders the data into a PDF instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import { getSchema } from "@/lib/db/services/schema-definition-service";
import {
  JOB_MAX_ROW_COUNT,
  createJob,
  failJob,
  listJobs,
  withFreshExportUrl,
} from "@/lib/db/services/generation-job-service";
import { enqueueGenerationJob } from "@/lib/queue/client";
import { JobStatus } from "@prisma/client";
import { validateObjectId } from "@/lib/utils/validate-object-id";
import { getTemplate } from "@/lib/db/services/visual-template-service";
import { parseTables } from "@/lib/db/services/schema-definition-service";
import {
  DOCUMENT_MAX_COUNT,
  readDocumentLayout,
  validateDocumentMapping,
  type DocumentJobConfig,
  type DocumentMapping,
} from "@/lib/validations/document-template";
import type { Prisma } from "@prisma/client";
import { isSupportedLocale } from "@/lib/engine/locale";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const workspaceId = searchParams.get("workspaceId");
  const schemaId = searchParams.get("schemaId") ?? undefined;

  // Jobs are always tenant-scoped: never list across workspaces
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId query param is required" },
      { status: 400 }
    );
  }
  const invalidWorkspaceId = validateObjectId(workspaceId, "workspaceId");
  if (invalidWorkspaceId) return invalidWorkspaceId;
  if (schemaId !== undefined) {
    const invalidSchemaId = validateObjectId(schemaId, "schemaId");
    if (invalidSchemaId) return invalidSchemaId;
  }
  const page = searchParams.get("page") ? Number(searchParams.get("page")) : undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const rawStatuses = searchParams.getAll("status");
  const validStatuses = rawStatuses.filter((s): s is JobStatus =>
    Object.values(JobStatus).includes(s as JobStatus)
  );

  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await listJobs(
    {
      workspaceId,
      schemaId,
      status: validStatuses.length ? validStatuses : undefined,
    },
    { page, limit }
  );
  result.data = await Promise.all(result.data.map(withFreshExportUrl));

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

  const { workspaceId, schemaId, rowCount, seed, locale, document } = body as {
    workspaceId?: string;
    schemaId?: string;
    rowCount?: number;
    seed?: number;
    locale?: string;
    /** Present for DOCUMENT jobs: render the generated data through a visual template. */
    document?: { templateId?: string; mapping?: DocumentMapping };
  };

  if (!workspaceId || typeof workspaceId !== "string") {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!schemaId || typeof schemaId !== "string") {
    return NextResponse.json({ error: "schemaId is required" }, { status: 400 });
  }
  const invalidId =
    validateObjectId(workspaceId, "workspaceId") ?? validateObjectId(schemaId, "schemaId");
  if (invalidId) return invalidId;
  if (
    rowCount !== undefined &&
    (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > JOB_MAX_ROW_COUNT)
  ) {
    return NextResponse.json(
      { error: `rowCount must be an integer between 1 and ${JOB_MAX_ROW_COUNT}` },
      { status: 400 }
    );
  }
  if (document !== undefined && rowCount !== undefined && rowCount > DOCUMENT_MAX_COUNT) {
    return NextResponse.json(
      { error: `Document jobs can render at most ${DOCUMENT_MAX_COUNT} documents` },
      { status: 400 }
    );
  }
  if (seed !== undefined && !Number.isInteger(seed)) {
    return NextResponse.json({ error: "seed must be an integer" }, { status: 400 });
  }
  if (locale !== undefined && (typeof locale !== "string" || !isSupportedLocale(locale))) {
    return NextResponse.json(
      { error: "locale must be a supported Faker locale (e.g. en_US, de_DE, fr)" },
      { status: 422 }
    );
  }

  // Verify ownership
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schema = await getSchema(schemaId);
  if (!schema || schema.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  // Document jobs snapshot the template, so later template edits never change a queued job
  let documentConfig: DocumentJobConfig | undefined;
  if (document !== undefined) {
    const { templateId, mapping } = document ?? {};
    if (!templateId || typeof templateId !== "string") {
      return NextResponse.json({ error: "document.templateId is required" }, { status: 400 });
    }
    const invalidTemplateId = validateObjectId(templateId, "document.templateId");
    if (invalidTemplateId) return invalidTemplateId;
    if (
      !mapping ||
      typeof mapping !== "object" ||
      typeof mapping.headerTable !== "string" ||
      (mapping.lineTable !== undefined && typeof mapping.lineTable !== "string") ||
      !mapping.fields ||
      typeof mapping.fields !== "object" ||
      Object.values(mapping.fields).some((v) => typeof v !== "string")
    ) {
      return NextResponse.json(
        { error: "document.mapping must be { headerTable, lineTable?, fields: { key: column } }" },
        { status: 400 }
      );
    }

    const template = await getTemplate(templateId);
    if (!template || (!template.isPublic && template.userId !== session.user.id)) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    const layout = readDocumentLayout(template.layoutConfig);
    if (!layout) {
      return NextResponse.json(
        { error: "This template is not a document template (Invoice or Statement)" },
        { status: 422 }
      );
    }

    const cleanMapping: DocumentMapping = {
      headerTable: mapping.headerTable,
      ...(mapping.lineTable && { lineTable: mapping.lineTable }),
      fields: Object.fromEntries(
        Object.entries(mapping.fields).filter(([, column]) => column !== "")
      ),
    };
    const errors = validateDocumentMapping(cleanMapping, layout, parseTables(schema.tables));
    if (errors.length) {
      return NextResponse.json({ error: errors[0], details: errors }, { status: 422 });
    }
    documentConfig = {
      template: {
        id: template.id,
        name: template.name,
        layoutConfig: template.layoutConfig as Record<string, unknown>,
      },
      mapping: cleanMapping,
    };
  }

  const job = await createJob({
    workspace: { connect: { id: workspaceId } },
    schema: { connect: { id: schemaId } },
    ...(documentConfig && {
      documentConfig: documentConfig as unknown as Prisma.InputJsonValue,
    }),
    ...(rowCount !== undefined && { rowCount }),
    ...(seed !== undefined && { seed }),
    ...(locale !== undefined && { locale }),
  });

  // Processed by the BullMQ worker; progress is polled via /api/jobs/[id]/progress
  try {
    await enqueueGenerationJob({ jobId: job.id, userId: session.user.id });
  } catch (error) {
    console.error(`[jobs] Failed to enqueue job ${job.id}:`, error);
    await failJob(job.id, [
      {
        message: "The job queue is unavailable. Please try again shortly.",
        severity: "error",
        code: "QUEUE_UNAVAILABLE",
      },
    ]).catch(() => undefined);
    return NextResponse.json(
      { error: "Job queue is unavailable. Please try again shortly." },
      { status: 503 }
    );
  }

  return NextResponse.json(job, { status: 201 });
}
