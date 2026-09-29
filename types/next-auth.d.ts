import { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";

/**
 * Extend NextAuth types to include custom user fields
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    role: string;
  }
}
