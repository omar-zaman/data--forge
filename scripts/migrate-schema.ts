/**
 * migrate-schema.ts
 *
 * Executes the full HackDataV2 schema migration in the correct order:
 *   1. migrateProjects  – Project  → Workspace
 *   2. migrateSchemas   – Schema   → SchemaDefinition
 *   3. migrateJobs      – back-fill new GenerationJob fields
 *   4. validateMigration – sanity-check referential integrity
 *   5. cleanupDeprecatedModels – drop old collections (optional, prompted)
 *
 * Usage:
 *   npx tsx scripts/migrate-schema.ts [--skip-cleanup]
 *
 * Flags:
 *   --skip-cleanup   Skip dropping deprecated collections (safe default)
 *
 * IMPORTANT: Run backup-database.ts first!
 */

import { PrismaClient } from "@prisma/client";
import {
  migrateProjects,
  migrateSchemas,
  migrateJobs,
  validateMigration,
  cleanupDeprecatedModels,
} from "../lib/db/services/migration-service";

// Ensure prisma singleton is initialised before the service imports it
const _prisma = new PrismaClient();

const SKIP_CLEANUP = process.argv.includes("--skip-cleanup");

function separator(label: string) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(`${line}`);
}

async function runPhase(
  label: string,
  fn: () => Promise<{ success: boolean; migratedCount: number; errors: string[] }>
) {
  separator(label);
  const result = await fn();
  console.log(`  Migrated : ${result.migratedCount} records`);
  if (result.errors.length > 0) {
    console.warn(`  Warnings :`);
    result.errors.forEach((e) => console.warn(`    • ${e}`));
  }
  if (!result.success) {
    throw new Error(`Phase "${label}" failed with errors above.`);
  }
  console.log(`  Status   : ✓ success`);
}

async function main() {
  console.log("\n🚀  DataForge → HackDataV2 Schema Migration");
  console.log(`    Started at: ${new Date().toISOString()}`);
  if (SKIP_CLEANUP) {
    console.log("    --skip-cleanup: deprecated collections will NOT be dropped");
  }

  // Phase 1
  await runPhase("Phase 1 – Migrate Projects → Workspaces", migrateProjects);

  // Phase 2
  await runPhase("Phase 2 – Migrate Schemas → SchemaDefinitions", migrateSchemas);

  // Phase 3
  await runPhase("Phase 3 – Back-fill GenerationJob fields", migrateJobs);

  // Validation
  separator("Validation – checking referential integrity");
  const validation = await validateMigration();
  if (!validation.isValid) {
    console.error("  ❌  Validation failed:");
    validation.errors.forEach((e) => console.error(`    • ${e}`));
    throw new Error("Migration validation failed. See errors above.");
  }
  console.log("  ✓  All referential integrity checks passed.");

  // Cleanup (optional)
  if (!SKIP_CLEANUP) {
    separator("Phase 4 – Cleanup deprecated collections");
    await cleanupDeprecatedModels();
    console.log("  ✓  Deprecated collections dropped.");
  } else {
    separator("Phase 4 – Cleanup skipped (--skip-cleanup)");
    console.log(
      "  Run without --skip-cleanup to drop: projects, schemas, datasets, templates, ai_conversations, export_logs"
    );
  }

  separator("Migration Complete");
  console.log(`  Finished at: ${new Date().toISOString()}`);
  console.log("  Next steps:");
  console.log("    1. Verify your application against the migrated data.");
  console.log("    2. Run your test suite.");
  console.log(
    "    3. If issues arise, restore from backup via: npx tsx scripts/rollback-migration.ts <backupTimestamp>"
  );
  console.log("");
}

main()
  .catch((err) => {
    console.error("\n❌  Migration failed:", err instanceof Error ? err.message : err);
    console.error(
      "\n   Restore from backup: npx tsx scripts/rollback-migration.ts <backupTimestamp>"
    );
    process.exit(1);
  })
  .finally(() => _prisma.$disconnect());
