/**
 * GET  /api/workspaces  – list workspaces for the authenticated user
 * POST /api/workspaces  – create a new workspace
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  listWorkspaces,
  createWorkspace,
} from "@/lib/db/services/workspace-service";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") ?? undefined;
  const dateFrom = searchParams.get("dateFrom")
    ? new Date(searchParams.get("dateFrom")!)
    : undefined;
  const dateTo = searchParams.get("dateTo")
    ? new Date(searchParams.get("dateTo")!)
    : undefined;
  const page = searchParams.get("page")
    ? Number(searchParams.get("page"))
    : undefined;
  const limit = searchParams.get("limit")
    ? Number(searchParams.get("limit"))
    : undefined;
  const sortBy = searchParams.get("sortBy") ?? undefined;
  const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") ?? undefined;

  const result = await listWorkspaces(
    { userId: session.user.id, search, dateFrom, dateTo },
    { page, limit, sortBy, sortOrder }
  );

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  const workspace = await createWorkspace({
    name: body.name.trim(),
    description: body.description ?? null,
    user: { connect: { id: session.user.id } },
  });

  return NextResponse.json(workspace, { status: 201 });
}
