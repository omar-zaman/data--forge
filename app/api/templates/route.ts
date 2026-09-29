/**
 * GET  /api/templates          – list templates (own + public with ?public=true)
 * POST /api/templates          – create a new visual template
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  listTemplates,
  createTemplate,
  validateLayoutConfig,
} from "@/lib/db/services/visual-template-service";
import type { LayoutConfig } from "@/types/database";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const publicOnly = searchParams.get("public") === "true";
  const category = searchParams.get("category") ?? undefined;
  const search = searchParams.get("search") ?? undefined;

  const templates = await listTemplates({
    userId: publicOnly ? undefined : session.user.id,
    isPublic: publicOnly ? true : undefined,
    category,
    search,
  });

  return NextResponse.json(templates);
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

  const { name, category, layoutConfig, isPublic } = body as {
    name?: string;
    category?: string;
    layoutConfig?: LayoutConfig;
    isPublic?: boolean;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (layoutConfig !== undefined) {
    const validation = validateLayoutConfig(layoutConfig);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: "Invalid layoutConfig", details: validation.errors },
        { status: 422 }
      );
    }
  }

  const template = await createTemplate({
    name: name.trim(),
    category: category ?? null,
    layoutConfig: (layoutConfig ?? {}) as object,
    isPublic: isPublic ?? false,
    user: { connect: { id: session.user.id } },
  });

  return NextResponse.json(template, { status: 201 });
}
