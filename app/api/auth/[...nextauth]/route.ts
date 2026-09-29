import { handlers } from "@/auth";

/**
 * NextAuth.js API Route Handler
 * Handles all auth requests: signin, signout, callback, session, etc.
 */

export const { GET, POST } = handlers;
