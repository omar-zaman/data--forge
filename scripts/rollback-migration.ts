/**
 * rollback-migration.ts
 *
 * Restores MongoDB collections from a backup created by backup-database.ts.
 * Each collection backup is re-inserted using insertMany via runCommandRaw.
 *
 * Usage:
 *   npx tsx scripts/rollback-migration.ts <backupTimestamp>
 *
 * Example:
 *   npx tsx scripts/rollback-migration.ts 2025-01-15T10-30-00-000Z
 *
 * The backupTimestamp is the directory name inside ./backups/ that was created
 * by backup-database.ts.  To list available backups:
 *   ls backups/
 *
 * WARNING:
 *   This script DROPS the following new collections before restoring:
 *     workspaces, schema_definitions, generation_jobs, visual_templates, validation_results
 *   and re-inserts data from the backup files.  Only run this if you need to
 *   undo a migration — it cannot be undone without another backup.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

/** Collections introduced by the new schema that should be dropped on rollback. */
const NEW_COLLECTIONS = [
  "workspaces",
  "schema_definitions",
  "generation_jobs",
  "visual_templates",
  "validation_results",
];

/** Old collections to restore from backup files. */
const RESTORE_COLLECTIONS = [
  "projects",
  "schemas",
  "datasets",
  "templates",
  "ai_conversations",
  "export_logs",
  "generation_jobs",
];

async function dropCollection(collection: string) {
  try {
    await prisma.$runCommandRaw({ drop: collection });
    console.log(`  Dropped collection: ${collection}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ns not found") || msg.includes("no such collection")) {
      console.log(`  Collection "${collection}" did not exist – skipping drop`);
    } else {
      throw err;
    }
  }
}

async function restoreCollection(
  collection: string,
  backupDir: string
): Promise<number> {
  const filePath = path.join(backupDir, `${collection}.json`);

  if (!fs.existsSync(filePath)) {
    console.log(`  No backup file for "${collection}" – skipping`);
    return 0;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const documents = JSON.parse(raw) as Record<string, unknown>[];

  if (documents.length === 0) {
    console.log(`  Backup for "${collection}" is empty – skipping insert`);
    return 0;
  }

  // Insert documents in batches of 500 to avoid hitting BSON size limits
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE) as Record<string, unknown>[];
    await prisma.$runCommandRaw({
      insert: collection,
      documents: batch as never,
    });
    inserted += batch.length;
  }

  return inserted;
}

async function main() {
  const backupTimestamp = process.argv[2];
  if (!backupTimestamp) {
    console.error("Usage: npx tsx scripts/rollback-migration.ts <backupTimestamp>");
    console.error('Example: npx tsx scripts/rollback-migration.ts 2025-01-15T10-30-00-000Z');
    console.error("\nAvailable backups:");
    const backupsRoot = path.join(process.cwd(), "backups");
    if (fs.existsSync(backupsRoot)) {
      fs.readdirSync(backupsRoot).forEach((d) => console.error(`  ${d}`));
    } else {
      console.error("  (no backups directory found)");
    }
    process.exit(1);
  }

  const backupDir = path.join(process.cwd(), "backups", backupTimestamp);
  if (!fs.existsSync(backupDir)) {
    console.error(`Backup directory not found: ${backupDir}`);
    process.exit(1);
  }

  const manifestPath = path.join(backupDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    console.log(`\n📋 Restoring from backup created at: ${manifest.createdAt}`);
  }

  console.log(`\n⚠️  This will DROP the new-schema collections and restore from:`);
  console.log(`   ${backupDir}\n`);

  // Step 1 – drop new collections
  console.log("Step 1 – Dropping new-schema collections...");
  for (const col of NEW_COLLECTIONS) {
    await dropCollection(col);
  }

  // Step 2 – restore old collections
  console.log("\nStep 2 – Restoring collections from backup...");
  let totalRestored = 0;
  for (const col of RESTORE_COLLECTIONS) {
    process.stdout.write(`  Restoring "${col}"... `);
    try {
      const count = await restoreCollection(col, backupDir);
      console.log(`✓  (${count} documents)`);
      totalRestored += count;
    } catch (err) {
      console.error(`✗  FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n✅ Rollback complete.`);
  console.log(`   Total documents restored: ${totalRestored}`);
  console.log("\n   Next steps:");
  console.log("     1. Revert application code to the previous version.");
  console.log("     2. Restart your development server.");
  console.log("     3. Verify the application works with the restored data.\n");
}

main()
  .catch((err) => {
    console.error("\n❌ Rollback failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
