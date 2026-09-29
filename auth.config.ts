import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getUserByEmail } from "@/lib/db/queries";
import { getSafeRedirect } from "@/lib/utils/safe-redirect";

/**
 * NextAuth.js v5 Configuration
 * This file contains the core auth configuration without the Prisma adapter
 * (which can't be used in Edge runtime)
 */

export default {
  providers: [
    // GitHub OAuth Provider
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),

    // Google OAuth Provider
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),

    // Credentials Provider (Email/Password)
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        const user = await getUserByEmail(credentials.email as string);

        if (!user || !user.password) {
          throw new Error("Invalid credentials");
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isPasswordValid) {
          throw new Error("Invalid credentials");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
    signOut: "/",
    error: "/login",
    verifyRequest: "/login",
  },
  callbacks: {
    async authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isProtected = /^\/(dashboard|workspace|projects|settings)(\/|$)/.test(
        nextUrl.pathname
      );
      const isOnAuth = nextUrl.pathname.startsWith("/login") || 
                       nextUrl.pathname.startsWith("/register");

      // Protect app routes (kept in sync with PROTECTED_ROUTE in proxy.ts)
      if (isProtected) {
        if (isLoggedIn) return true;
        return false; // Redirect to login page
      }

      // Redirect authenticated users away from auth pages
      if (isOnAuth && isLoggedIn) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },

    // Blocks open redirects through Auth.js's own ?callbackUrl= handling:
    // only same-origin destinations are allowed
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${getSafeRedirect(url, "/")}`;
      try {
        const target = new URL(url);
        if (target.origin === new URL(baseUrl).origin) {
          return `${baseUrl}${getSafeRedirect(target.pathname + target.search + target.hash, "/")}`;
        }
      } catch {
        // Malformed URL — fall through to the default
      }
      return `${baseUrl}/dashboard`;
    },
  },
} satisfies NextAuthConfig;
