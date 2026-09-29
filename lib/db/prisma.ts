import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient singleton instance
 * Prevents multiple instances during Next.js hot-reloading in development
 */

const prismaClientSingleton = () => {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}

/**
 * Helper function to safely disconnect Prisma Client
 * Useful for serverless environments and testing
 */
export async function disconnectPrisma() {
  await prisma.$disconnect();
}

/**
 * Helper function to check database connection
 * Tests connection by attempting to count users
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.user.findFirst();
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}
