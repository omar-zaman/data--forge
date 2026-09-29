/**
 * Database Seeding Script
 * Clears the database and populates a ready-to-demo account.
 * Run with: npm run db:seed
 *
 * Login: demo@dataforge.ai / password123
 */

import bcrypt from "bcryptjs";
import { PrismaClient, UserRole, DataType } from "@prisma/client";
import type { TableStructure } from "../../types/database";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@dataforge.ai";
const DEMO_PASSWORD = "password123";
const BCRYPT_COST = 12;

/**
 * Customers → Orders, in the exact shape the Schema Designer saves
 * (see tableDraftsToTableStructures in components/modules/schema/schema-designer.tsx).
 */
const CUSTOMERS_ORDERS_TABLES: TableStructure[] = [
  {
    name: "customers",
    columns: [
      { name: "id", type: "UUID", nullable: false, primaryKey: true, constraints: [] },
      { name: "first_name", type: "FirstName", nullable: false, constraints: [] },
      { name: "last_name", type: "LastName", nullable: false, constraints: [] },
      { name: "email", type: "Email", nullable: false, constraints: [{ type: "UNIQUE" }] },
      { name: "phone", type: "Phone", nullable: true, constraints: [] },
      { name: "city", type: "City", nullable: false, constraints: [] },
      { name: "country", type: "Country", nullable: false, constraints: [] },
      { name: "signup_date", type: "DateTime", nullable: false, constraints: [] },
    ],
    nullRates: { phone: 0.1 },
  },
  {
    name: "orders",
    columns: [
      { name: "id", type: "UUID", nullable: false, primaryKey: true, constraints: [] },
      { name: "customer_id", type: "UUID", nullable: false, constraints: [] },
      { name: "order_date", type: "Date", nullable: false, constraints: [] },
      { name: "quantity", type: "Integer", nullable: false, constraints: [] },
      { name: "total_amount", type: "Float", nullable: false, constraints: [] },
      { name: "is_paid", type: "Boolean", nullable: false, constraints: [] },
    ],
    foreignKeys: [{ fromColumn: "customer_id", toTable: "customers", toColumn: "id" }],
    cardinalities: {
      customer_id: {
        relationship: "oneToMany",
        targetTable: "customers",
        minRecords: 1,
        maxRecords: 5,
      },
    },
  },
];

/**
 * MongoDB has no foreign keys, so Prisma emulates referential actions in the
 * client. Delete children before parents so nothing trips the emulated
 * Restrict on GenerationJob.schema.
 */
async function clearDatabase() {
  await prisma.validationResult.deleteMany();
  await prisma.generationJob.deleteMany();
  await prisma.schemaDefinition.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.visualTemplate.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  console.log("🌱 Starting database seed...");

  await clearDatabase();
  console.log("🧹 Cleared existing data");

  const demoUser = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Demo User",
      password: await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST),
      role: UserRole.USER,
      emailVerified: new Date(),
      image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Demo",
    },
  });
  console.log("✅ Created demo user");

  const workspace = await prisma.workspace.create({
    data: {
      name: "Demo Workspace",
      description: "Sample workspace with a Customers → Orders relational schema",
      userId: demoUser.id,
    },
  });
  console.log("✅ Created workspace");

  await prisma.schemaDefinition.create({
    data: {
      workspaceId: workspace.id,
      name: "Customers & Orders",
      dataType: DataType.RELATIONAL,
      version: 1,
      tables: CUSTOMERS_ORDERS_TABLES as object[],
    },
  });
  console.log("✅ Created schema definition");

  console.log("\n🎉 Database seeding completed successfully!");
  console.log(`   Login:     ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`   Workspace: ${workspace.name}`);
  console.log(`   Schema:    Customers & Orders (customers, orders)`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
