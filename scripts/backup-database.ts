/**
 * backup-database.ts
 *
 * Creates a timestamped JSON backup of all collections that will be affected
 * by the MongoDB schema transition.  Run this BEFORE executing the migration.
 *
 * Usage:
 *   npx tsx scripts/backup-database.ts
 *
 * Output:
 *   backups/<timestamp>/
 *     projects.json
 *     schemas.json
 *     datasets.json
 *     templates.json
 *     ai_conversations.json
 *     export_logs.json
 *     generation_jobs.json
 *     workspaces.json          (new collection – backed up if already exists)
 *     schema_definitions.json  (new collection – backed up if already exists)
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

/** Collections to back up via runCommandRaw. */
const COLLECTIONS = [
  "projects",
  "schemas",
  "datasets",
  "templates",
  "ai_conversations",
  "export_logs",
  "generation_jobs",
  "workspaces",
  "schema_definitions",
  "visual_templates",
  "validation_results",
];

async function backupCollection(
  collection: string,
  outputDir: string
): Promise<number> {
  try {
    const result = await prisma.$runCommandRaw({
      find: collection,
      filter: {},
      limit: 0, // 0 = no limit
    });

    const cursor = result as { cursor?: { firstBatch?: unknown[] } };
    const documents = cursor?.cursor?.firstBatch ?? [];

    const filePath = path.join(outputDir, `${collection}.json`);
    fs.writeFileSync(filePath, JSON.stringify(documents, null, 2), "utf8");

    return documents.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ns does not exist") || msg.includes("no such collection")) {
      console.log(`  ⚠  Collection "${collection}" does not exist – skipping`);
      return 0;
    }
    throw err;
  }
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(process.cwd(), "backups", timestamp);

  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`\n📦 Starting database backup → ${backupDir}\n`);

  let totalDocuments = 0;

  for (const collection of COLLECTIONS) {
    process.stdout.write(`  Backing up "${collection}"... `);
    try {
      const count = await backupCollection(collection, backupDir);
      console.log(`✓  (${count} documents)`);
      totalDocuments += count;
    } catch (err) {
      console.error(`✗  FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Write a manifest file with metadata
  const manifest = {
    timestamp,
    backupDir,
    collections: COLLECTIONS,
    totalDocuments,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  console.log(`\n✅ Backup complete.`);
  console.log(`   Total documents: ${totalDocuments}`);
  console.log(`   Manifest:        ${path.join(backupDir, "manifest.json")}\n`);
}

main()
  .catch((err) => {
    console.error("\n❌ Backup failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
