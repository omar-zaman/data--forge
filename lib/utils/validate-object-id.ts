/**
 * MongoDB ObjectId validation.
 * Prisma's MongoDB connector throws (→ unhandled 500) on malformed ObjectIds
 * instead of returning a miss, so every externally supplied id must be checked
 * before it reaches a query.
 */

import { NextResponse } from "next/server";

export const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/** True when `id` is a 24-character hex string. */
export function isValidObjectId(id: unknown): id is string {
  return typeof id === "string" && OBJECT_ID_PATTERN.test(id);
}

/**
 * Returns a 400 response when `id` is not a valid ObjectId, or null when it is.
 * Usage: `const invalid = validateObjectId(id); if (invalid) return invalid;`
 */
export function validateObjectId(id: unknown, field = "id"): NextResponse | null {
  if (isValidObjectId(id)) return null;
  return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
}
