import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/db/prisma";
import authConfig from "./auth.config";

/**
 * NextAuth.js v5 Main Configuration
 * Includes Prisma adapter for database session management
 */

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  ...authConfig,
  callbacks: {
    // Keep authorized + redirect from auth.config.ts (a plain override would drop them)
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, session }) {
      // Initial sign in
      if (user) {
        token.id = user.id as string;
        token.role = user.role as string;
        token.email = user.email as string;
        token.name = user.name as string;
        token.picture = user.image as string;
      }

      // Update session
      if (trigger === "update" && session) {
        token.name = session.name as string;
        token.picture = session.image as string;
      }

      return token;
    },

    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.image = token.picture as string;
      }

      return session;
    },

    async signIn({ user, account }) {
      if (account?.provider === "google" || account?.provider === "github") {
        if (!user.email) return false;

        // Only refresh profile data for an OAuth account already linked to a
        // user. This callback runs before Auth.js rejects an unlinked account
        // (OAuthAccountNotLinked), so matching on email alone would let anyone
        // with a same-email OAuth identity overwrite the victim's profile.
        const linkedAccount = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
          include: { user: true },
        });

        if (linkedAccount) {
          await prisma.user.update({
            where: { id: linkedAccount.userId },
            data: {
              name: user.name || linkedAccount.user.name,
              image: user.image || linkedAccount.user.image,
            },
          });
        }
      }

      return true;
    },
  },
  events: {
    async linkAccount({ user }) {
      // Mark email as verified when account is linked
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    },
  },
  debug: process.env.NODE_ENV === "development",
});
