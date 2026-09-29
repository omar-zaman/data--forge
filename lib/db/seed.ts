/**
 * Database Seeding Script
 * Populates the HackDataV2 schema with demo data.
 * Run with: npm run db:seed
 */

import { PrismaClient, UserRole, JobStatus, DataType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  // ============================================================
  // Users
  // ============================================================
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@dataforge.dev" },
    update: {},
    create: {
      email: "admin@dataforge.dev",
      name: "Admin User",
      role: UserRole.ADMIN,
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Admin",
    },
  });

  const developerUser = await prisma.user.upsert({
    where: { email: "developer@dataforge.dev" },
    update: {},
    create: {
      email: "developer@dataforge.dev",
      name: "John Developer",
      role: UserRole.DEVELOPER,
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=John",
    },
  });

  const regularUser = await prisma.user.upsert({
    where: { email: "user@dataforge.dev" },
    update: {},
    create: {
      email: "user@dataforge.dev",
      name: "Jane User",
      role: UserRole.USER,
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Jane",
    },
  });

  console.log("✅ Created users");

  // ============================================================
  // Workspaces (replaces Projects)
  // ============================================================
  const workspace1 = await prisma.workspace.create({
    data: {
      name: "E-Commerce Platform",
      description: "Synthetic data for an e-commerce application",
      userId: developerUser.id,
    },
  });

  const workspace2 = await prisma.workspace.create({
    data: {
      name: "Task Management System",
      description: "Synthetic data for a collaborative task tracker",
      userId: developerUser.id,
    },
  });

  const workspace3 = await prisma.workspace.create({
    data: {
      name: "Blog Platform",
      description: "Synthetic data for a modern blog platform",
      userId: regularUser.id,
    },
  });

  console.log("✅ Created workspaces");

  // ============================================================
  // Schema Definitions
  // ============================================================
  const schema1 = await prisma.schemaDefinition.create({
    data: {
      workspaceId: workspace1.id,
      name: "E-Commerce Schema",
      dataType: DataType.RELATIONAL,
      version: 1,
      tables: [
        {
          name: "products",
          columns: [
            { name: "id", type: "string", primaryKey: true },
            { name: "name", type: "string", nullable: false },
            { name: "price", type: "number", nullable: false },
            { name: "category", type: "string" },
            { name: "stock", type: "number" },
          ],
        },
        {
          name: "orders",
          columns: [
            { name: "id", type: "string", primaryKey: true },
            { name: "userId", type: "string" },
            { name: "total", type: "number" },
            { name: "status", type: "string" },
          ],
          foreignKeys: [
            { fromColumn: "userId", toTable: "products", toColumn: "id" },
          ],
        },
      ],
    },
  });

  const schema2 = await prisma.schemaDefinition.create({
    data: {
      workspaceId: workspace2.id,
      name: "Task Schema",
      dataType: DataType.TABULAR,
      version: 1,
      tables: [
        {
          name: "tasks",
          columns: [
            { name: "id", type: "string", primaryKey: true },
            { name: "title", type: "string", nullable: false },
            { name: "description", type: "text" },
            { name: "status", type: "string" },
            { name: "assigneeId", type: "string" },
          ],
        },
      ],
    },
  });

  console.log("✅ Created schema definitions");

  // ============================================================
  // Generation Jobs
  // ============================================================
  const job1 = await prisma.generationJob.create({
    data: {
      workspaceId: workspace1.id,
      schemaId: schema1.id,
      status: JobStatus.COMPLETED,
      progress: 100,
      rowCount: 500,
      locale: "en_US",
      healthCheckPassed: true,
      completedAt: new Date(),
    },
  });

  await prisma.generationJob.create({
    data: {
      workspaceId: workspace2.id,
      schemaId: schema2.id,
      status: JobStatus.PROCESSING,
      progress: 45,
      rowCount: 200,
      locale: "en_US",
    },
  });

  await prisma.generationJob.create({
    data: {
      workspaceId: workspace3.id,
      schemaId: schema2.id,
      status: JobStatus.QUEUED,
      progress: 0,
    },
  });

  console.log("✅ Created generation jobs");

  // ============================================================
  // Validation Results
  // ============================================================
  await prisma.validationResult.create({
    data: {
      jobId: job1.id,
      isPassed: true,
      summary: {
        passed: 500,
        failed: 0,
        warnings: 2,
      },
      errors: [],
    },
  });

  console.log("✅ Created validation results");

  // ============================================================
  // Visual Templates
  // ============================================================
  await prisma.visualTemplate.create({
    data: {
      userId: adminUser.id,
      name: "Standard Report",
      category: "report",
      isPublic: true,
      layoutConfig: {
        pageSize: "A4",
        orientation: "portrait",
        margins: { top: 20, right: 20, bottom: 20, left: 20 },
        sections: [
          {
            id: "header",
            type: "header",
            position: { x: 0, y: 0, width: 100, height: 10 },
          },
          {
            id: "body",
            type: "table",
            position: { x: 0, y: 10, width: 100, height: 80 },
          },
        ],
      },
    },
  });

  await prisma.visualTemplate.create({
    data: {
      userId: developerUser.id,
      name: "Data Summary Card",
      category: "card",
      isPublic: false,
      layoutConfig: {
        pageSize: "A4",
        orientation: "landscape",
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      },
    },
  });

  console.log("✅ Created visual templates");

  console.log("\n🎉 Database seeding completed successfully!");
  console.log(`   Users:              3`);
  console.log(`   Workspaces:         3`);
  console.log(`   Schema Definitions: 2`);
  console.log(`   Generation Jobs:    3`);
  console.log(`   Validation Results: 1`);
  console.log(`   Visual Templates:   2`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
