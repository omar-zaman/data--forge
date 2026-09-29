/**
 * GET    /api/workspaces/[id]  – fetch a single workspace (with relations)
 * PATCH  /api/workspaces/[id]  – update name / description
 * DELETE /api/workspaces/[id]  – delete workspace (cascades to schemas + jobs)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getWorkspaceWithRelations,
  updateWorkspace,
  deleteWorkspace,
} from "@/lib/db/services/workspace-service";

type Params = { params: Promise<{ id: string }> };

async function requireOwnership(workspaceId: string, userId: string) {
  const workspace = await getWorkspaceWithRelations(workspaceId);
  if (!workspace) return null;
  if (workspace.userId !== userId) return "forbidden";
  return workspace;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await requireOwnership(id, session.user.id);
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
  const check = await requireOwnership(id, session.user.id);
  if (!check) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (check === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if ("description" in body) {
    data.description = body.description ?? null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await updateWorkspace(id, data);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const check = await requireOwnership(id, session.user.id);
  if (!check) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (check === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await deleteWorkspace(id);
  return new NextResponse(null, { status: 204 });
}
