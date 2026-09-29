/**
 * Verifies the MongoDB connection via Prisma.
 * Run with: npx tsx scripts/check-db.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to .env (Prisma CLI does not read .env.local).");
  }

  await prisma.$connect();
  const userCount = await prisma.user.count();

  console.log("✅ MongoDB Connection Successful");
  console.log(`   Users in database: ${userCount}`);
}

main()
  .catch((error) => {
    console.error("❌ MongoDB connection failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
