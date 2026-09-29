import { auth } from "@/auth";
import prisma from "@/lib/db/prisma";
import type { User } from "@prisma/client";

/**
 * Authentication Session Helpers
 * Utilities to safely fetch user credentials in Server Components and API routes
 */

/**
 * Get the current authenticated user from the session
 * @returns User object or null if not authenticated
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    return user;
  } catch (error) {
    console.error("Error fetching current user:", error);
    return null;
  }
}

/**
 * Get the current user's ID from the session
 * @returns User ID string or null if not authenticated
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id || null;
}

/**
 * Get the current user's role from the session
 * @returns User role or null if not authenticated
 */
export async function getCurrentUserRole(): Promise<string | null> {
  const session = await auth();
  return session?.user?.role || null;
}

/**
 * Check if the current user is authenticated
 * @returns true if user is authenticated, false otherwise
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await auth();
  return !!session?.user;
}

/**
 * Check if the current user has a specific role
 * @param role - The role to check (ADMIN, DEVELOPER, USER)
 * @returns true if user has the role, false otherwise
 */
export async function hasRole(role: string): Promise<boolean> {
  const session = await auth();
  return session?.user?.role === role;
}

/**
 * Check if the current user is an admin
 * @returns true if user is admin, false otherwise
 */
export async function isAdmin(): Promise<boolean> {
  return await hasRole("ADMIN");
}

/**
 * Check if the current user is a developer
 * @returns true if user is developer or admin, false otherwise
 */
export async function isDeveloper(): Promise<boolean> {
  const role = await getCurrentUserRole();
  return role === "DEVELOPER" || role === "ADMIN";
}

/**
 * Require authentication - throws error if user is not authenticated
 * Use this at the top of Server Actions or API routes
 * @returns User object
 * @throws Error if user is not authenticated
 */
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthorized - Please sign in to continue");
  }

  return user;
}

/**
 * Require specific role - throws error if user doesn't have the role
 * @param role - The required role
 * @returns User object
 * @throws Error if user doesn't have the required role
 */
export async function requireRole(role: string): Promise<User> {
  const user = await requireAuth();

  if (user.role !== role && user.role !== "ADMIN") {
    throw new Error(`Unauthorized - ${role} role required`);
  }

  return user;
}

/**
 * Require admin role - throws error if user is not an admin
 * @returns User object
 * @throws Error if user is not an admin
 */
export async function requireAdmin(): Promise<User> {
  return await requireRole("ADMIN");
}

/**
 * Get the current user with related data
 * @returns User with projects, or null if not authenticated
 */
export async function getCurrentUserWithProjects() {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        workspaces: {
          orderBy: { updatedAt: "desc" },
          take: 10,
        },
      },
    });

    return user;
  } catch (error) {
    console.error("Error fetching user with projects:", error);
    return null;
  }
}
