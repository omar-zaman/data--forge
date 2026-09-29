/**
 * GET  /api/schemas?workspaceId=  – list schema definitions for a workspace
 * POST /api/schemas               – create a new schema definition
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import {
  createSchema,
  listSchemas,
  validateTableStructure,
} from "@/lib/db/services/schema-definition-service";
import type { TableStructure } from "@/types/database";
import { DataType } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId query param is required" },
      { status: 400 }
    );
  }

  // Verify the caller owns the workspace
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schemas = await listSchemas(workspaceId);
  return NextResponse.json(schemas);
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

  const { workspaceId, name, dataType, tables, version } = body as {
    workspaceId?: string;
    name?: string;
    dataType?: string;
    tables?: TableStructure[];
    version?: number;
  };

  if (!workspaceId || typeof workspaceId !== "string") {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!dataType || !Object.values(DataType).includes(dataType as DataType)) {
    return NextResponse.json(
      { error: `dataType must be one of: ${Object.values(DataType).join(", ")}` },
      { status: 400 }
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

  // Pre-validate table structure before persisting
  if (tables && Array.isArray(tables) && tables.length > 0) {
    const validation = validateTableStructure(tables as TableStructure[]);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: "Invalid table structure", details: validation.errors },
        { status: 422 }
      );
    }
  }

  const schema = await createSchema(
    workspaceId,
    name.trim(),
    dataType as DataType,
    tables ?? [],
    version ?? 1
  );

  return NextResponse.json(schema, { status: 201 });
}
