"use server";

import bcrypt from "bcryptjs";
import { auth, signIn, signOut } from "@/auth";
import prisma from "@/lib/db/prisma";
import { AuthError } from "next-auth";
import { getSafeRedirect } from "@/lib/utils/safe-redirect";

/**
 * Server Actions for Authentication
 * These run on the server and can be called from Client Components
 */

export interface SignUpData {
  name: string;
  email: string;
  password: string;
}

export interface SignInData {
  email: string;
  password: string;
}

/**
 * Register a new user with email and password
 */
export async function signUp(data: SignUpData) {
  try {
    const { name, email, password } = data;

    // Validate input
    if (!email || !password || !name) {
      return { error: "All fields are required" };
    }

    if (password.length < 8) {
      return { error: "Password must be at least 8 characters long" };
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return { error: "Email already registered" };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "USER",
      },
    });

    // Automatically sign in the user
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    return { success: true, userId: user.id };
  } catch (error) {
    console.error("Sign up error:", error);
    return { error: "An error occurred during sign up" };
  }
}

/**
 * Sign in with email and password
 */
export async function signInWithCredentials(data: SignInData) {
  try {
    const { email, password } = data;

    if (!email || !password) {
      return { error: "Email and password are required" };
    }

    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return { error: "Invalid credentials" };
        default:
          return { error: "Authentication failed" };
      }
    }

    throw error;
  }
}

/**
 * Sign in with OAuth provider (Google, GitHub)
 */
export async function signInWithProvider(
  provider: "google" | "github",
  callbackUrl?: string
) {
  try {
    await signIn(provider, {
      // Re-validated here: server actions can be invoked with arbitrary input
      redirectTo: getSafeRedirect(callbackUrl),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "OAuth authentication failed" };
    }
    throw error;
  }
}

/**
 * Sign out the current user
 */
export async function signOutUser() {
  try {
    await signOut({
      redirectTo: "/",
    });
  } catch (error) {
    console.error("Sign out error:", error);
    throw error;
  }
}

/**
 * Update the signed-in user's password (requires current password).
 * The user is taken from the session, never from the caller — server actions
 * are public endpoints, so a client-supplied userId would allow IDOR.
 */
export async function updatePassword(
  currentPassword: string,
  newPassword: string
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { error: "You must be signed in to change your password" };
    }

    // Validate input
    if (!currentPassword || !newPassword) {
      return { error: "Both passwords are required" };
    }

    if (newPassword.length < 8) {
      return { error: "New password must be at least 8 characters long" };
    }

    if (newPassword === currentPassword) {
      return { error: "New password must be different from the current one" };
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return { error: "User not found" };
    }

    if (!user.password) {
      return { error: "This account signs in with Google or GitHub and has no password" };
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      return { error: "Current password is incorrect" };
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { success: true };
  } catch (error) {
    console.error("Update password error:", error);
    return { error: "An error occurred while updating password" };
  }
}

/**
 * Request password reset (for future email implementation)
 */
export async function requestPasswordReset(email: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal if email exists
      return { success: true };
    }

    // TODO: Generate reset token and send email
    // For now, just return success
    return { success: true };
  } catch (error) {
    console.error("Password reset error:", error);
    return { error: "An error occurred" };
  }
}
