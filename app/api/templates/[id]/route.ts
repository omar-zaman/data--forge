/**
 * GET    /api/templates/[id]  – fetch a single visual template
 * PATCH  /api/templates/[id]  – update template fields
 * DELETE /api/templates/[id]  – delete a template
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
  validateLayoutConfig,
} from "@/lib/db/services/visual-template-service";
import type { LayoutConfig } from "@/types/database";

type Params = { params: Promise<{ id: string }> };

async function resolveAndAuthorize(templateId: string, userId: string) {
  const template = await getTemplate(templateId);
  if (!template) return null;
  // Public templates are readable by anyone; only owners can mutate
  return template;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await getTemplate(id);
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Allow access if the template is public or the user owns it
  if (!template.isPublic && template.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(template);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await resolveAndAuthorize(id, session.user.id);
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (template.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as {
    name?: string;
    category?: string | null;
    layoutConfig?: LayoutConfig;
    isPublic?: boolean;
  };

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if ("category" in body) data.category = body.category ?? null;
  if (typeof body.isPublic === "boolean") data.isPublic = body.isPublic;
  if (body.layoutConfig !== undefined) {
    const validation = validateLayoutConfig(body.layoutConfig);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: "Invalid layoutConfig", details: validation.errors },
        { status: 422 }
      );
    }
    data.layoutConfig = body.layoutConfig as object;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await updateTemplate(id, data);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await getTemplate(id);
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (template.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await deleteTemplate(id);
  return new NextResponse(null, { status: 204 });
}
