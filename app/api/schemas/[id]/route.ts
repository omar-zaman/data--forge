/**
 * GET    /api/schemas/[id]  – fetch a single schema definition
 * PATCH  /api/schemas/[id]  – update name / dataType / tables
 * DELETE /api/schemas/[id]  – delete a schema definition
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import {
  getSchema,
  updateSchema,
  deleteSchema,
} from "@/lib/db/services/schema-definition-service";
import type { TableStructure } from "@/types/database";
import { DataType } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

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
    name?: string;
    dataType?: string;
    tables?: TableStructure[];
  };

  const updateData: { name?: string; dataType?: DataType; tables?: TableStructure[] } = {};
  if (typeof body.name === "string" && body.name.trim()) {
    updateData.name = body.name.trim();
  }
  if (body.dataType !== undefined) {
    if (!Object.values(DataType).includes(body.dataType as DataType)) {
      return NextResponse.json(
        { error: `dataType must be one of: ${Object.values(DataType).join(", ")}` },
        { status: 400 }
      );
    }
    updateData.dataType = body.dataType as DataType;
  }
  if (body.tables !== undefined) {
    updateData.tables = body.tables;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await updateSchema(id, updateData);
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

  await deleteSchema(id);
  return new NextResponse(null, { status: 204 });
}
