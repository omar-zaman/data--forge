/**
 * GET  /api/schemas/[id]/versions  – list all versions of a schema (by name + workspace)
 * POST /api/schemas/[id]/versions  – create a new version of a schema
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/db/services/workspace-service";
import {
  getSchema,
  listVersions,
  createNewVersion,
} from "@/lib/db/services/schema-definition-service";

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
  const schema = await resolveAndAuthorize(id, session.user.id);
  if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (schema === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const versions = await listVersions(schema.workspaceId, schema.name);
  return NextResponse.json(versions);
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const schema = await resolveAndAuthorize(id, session.user.id);
  if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (schema === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const newVersion = await createNewVersion(id);
  return NextResponse.json(newVersion, { status: 201 });
}
