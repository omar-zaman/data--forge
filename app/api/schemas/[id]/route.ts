/**
 * GET    /api/schemas/[id]  – fetch a single schema definition
 * PATCH  /api/schemas/[id]  – update name / dataType / tables (only while the
 *                              schema has no generation jobs; 403 otherwise)
 * DELETE /api/schemas/[id]  – delete a schema definition
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import {
  countSchemaJobs,
  getSchema,
  updateSchema,
  validateTableStructure,
  deleteSchema,
} from "@/lib/db/services/schema-definition-service";
import type { TableStructure } from "@/types/database";
import { DataType, Prisma } from "@prisma/client";
import { validateObjectId } from "@/lib/utils/validate-object-id";

type Params = { params: Promise<{ id: string }> };

const SCHEMA_LOCKED_MESSAGE =
  "Cannot edit a schema that has existing generation jobs. Please create a new version.";

async function resolveAndAuthorize(schemaId: string, userId: string) {
  const schema = await getSchema(schemaId);
  if (!schema) return null;
  const workspace = await getWorkspace(schema.workspaceId);
  if (!workspace || workspace.userId !== userId) return "forbidden";
  return schema;
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

  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest, { params }: Params) {
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

  // Versions are immutable once used: existing jobs must stay reproducible
  // from the definition they were generated with
  if ((await countSchemaJobs(id)) > 0) {
    return NextResponse.json(
      { error: SCHEMA_LOCKED_MESSAGE, code: "SCHEMA_LOCKED" },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    dataType?: unknown;
    tables?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updateData: { name?: string; dataType?: DataType; tables?: TableStructure[] } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 422 });
    }
    updateData.name = body.name.trim();
  }
  if (body.dataType !== undefined) {
    if (!Object.values(DataType).includes(body.dataType as DataType)) {
      return NextResponse.json(
        { error: `dataType must be one of: ${Object.values(DataType).join(", ")}` },
        { status: 422 }
      );
    }
    updateData.dataType = body.dataType as DataType;
  }
  if (body.tables !== undefined) {
    const validation = validateTableStructure(body.tables as TableStructure[]);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: "Invalid table structure", details: validation.errors },
        { status: 422 }
      );
    }
    updateData.tables = body.tables as TableStructure[];
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 422 });
  }

  try {
    const updated = await updateSchema(id, updateData);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json({ error: "Invalid schema data" }, { status: 422 });
    }
    console.error("Schema update failed:", err);
    return NextResponse.json({ error: "Failed to update schema" }, { status: 500 });
  }
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

  // Associated generation jobs are deleted along with the schema
  await deleteSchema(id);
  return new NextResponse(null, { status: 204 });
}
