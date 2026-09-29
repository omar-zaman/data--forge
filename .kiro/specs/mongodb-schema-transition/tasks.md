# Implementation Plan: MongoDB Schema Transition

## Overview

This implementation plan converts the MongoDB schema from the current DataForge structure to the HackDataV2 Synthetic Data & Document Platform schema. The implementation follows a phased approach: update Prisma schema, generate types, create service layer, update API routes, write tests, and execute migration.

## Tasks

- [x] 1. Update Prisma Schema and Generate Types
  - [x] 1.1 Update enums in Prisma schema
    - Update `prisma/schema.prisma` to define JobStatus enum with values QUEUED, PROCESSING, VALIDATING, COMPLETED, FAILED
    - Update ExportFormat enum with values CSV, JSON, SQL, PDF, ZIP (remove TYPESCRIPT, GRAPHQL)
    - Add new DataType enum with values TABULAR, RELATIONAL, DOCUMENT
    - _Requirements: 1.1, 1.3, 2.1, 2.3, 3.1, 3.2_

  - [x] 1.2 Rename Project model to Workspace
    - Update `prisma/schema.prisma` to rename the Project model to Workspace
    - Update all field names and relations from "project" to "workspace"
    - Maintain userId foreign key relationship
    - Add proper indexes on userId and createdAt
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4_

  - [x] 1.3 Create SchemaDefinition model
    - Add SchemaDefinition model to `prisma/schema.prisma` with fields: id, workspaceId, name, dataType, tables (Json), version, createdAt, updatedAt
    - Add foreign key relation to Workspace with onDelete: Cascade
    - Add indexes on workspaceId, name, and version
    - Set default value for tables field as empty JSON array
    - Set default value for version field as 1
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 1.4 Update GenerationJob model
    - Update `prisma/schema.prisma` GenerationJob model with new fields: workspaceId, schemaId, progress, seed, locale, healthCheckPassed, validationErrors, exportUrl, fileSizeBytes, completedAt
    - Update status field to use new JobStatus enum
    - Add foreign key relations to Workspace and SchemaDefinition
    - Add indexes on workspaceId, schemaId, status, and createdAt
    - Set appropriate default values (progress: 0, validationErrors: [], status: QUEUED)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [x] 1.5 Create VisualTemplate model
    - Add VisualTemplate model to `prisma/schema.prisma` with fields: id, userId, name, category, layoutConfig (Json), isPublic, createdAt, updatedAt
    - Add foreign key relation to User with onDelete: Cascade
    - Set default value for isPublic as false
    - Add indexes on userId, category, and isPublic
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 1.6 Update ValidationResult model
    - Update `prisma/schema.prisma` ValidationResult model to store errors as Json array
    - Maintain existing fields: id, jobId, summary (Json), isPassed, createdAt, updatedAt
    - Maintain foreign key relation to GenerationJob
    - Maintain indexes on jobId and isPassed
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 1.7 Remove deprecated models from Prisma schema
    - Remove Dataset model from `prisma/schema.prisma`
    - Remove old Schema model from schema (replaced by SchemaDefinition)
    - Remove old Template model from schema (replaced by VisualTemplate)
    - Remove AIConversation model from schema
    - Remove ExportLog model from schema
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 1.8 Generate Prisma client and run initial migration
    - Run `npx prisma generate` to generate updated Prisma client
    - Run `npx prisma migrate dev --name mongodb-schema-transition` to create migration
    - Verify migration file contains all expected changes
    - Test migration on development database
    - _Requirements: All schema requirements_

  - [x] 1.9 Create TypeScript type definitions
    - Update `types/database.ts` with Workspace types (Workspace, WorkspaceWithRelations, WorkspaceWithSchemas, WorkspaceWithJobs)
    - Add SchemaDefinition types and TableStructure, ColumnDefinition, ForeignKeyConstraint, CardinalityConstraint interfaces
    - Add GenerationJob types with all new fields
    - Add VisualTemplate types and LayoutConfig, LayoutSection, FontConfig, ColorPalette interfaces
    - Add ValidationError interface with field, message, severity, code
    - Export all enum types from Prisma client
    - Add filter types: WorkspaceFilters, GenerationJobFilters, TemplateFilters
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

- [x] 2. Checkpoint - Verify schema and types
  - Ensure all tests pass, verify Prisma schema compiles, check TypeScript types are correct, ask the user if questions arise.

- [ ] 3. Create Service Layer
  - [-] 3.1 Create WorkspaceService
    - Create `lib/db/services/workspace-service.ts` with CRUD operations
    - Implement createWorkspace, getWorkspace, listWorkspaces, updateWorkspace, deleteWorkspace methods
    - Implement getWorkspaceWithSchemas and getWorkspaceWithJobs methods for relation queries
    - Add proper TypeScript types for all method parameters and return values
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [-] 3.2 Create SchemaDefinitionService
    - Create `lib/db/services/schema-definition-service.ts` with CRUD and validation operations
    - Implement createSchema, getSchema, listSchemas, updateSchema, deleteSchema methods
    - Implement validateTableStructure method to validate table structure JSON
    - Implement parseTables and formatTables methods for JSON serialization
    - Implement createNewVersion and listVersions methods for version management
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 12.1, 12.2, 12.3_

  - [-] 3.3 Create GenerationJobService
    - Create `lib/db/services/generation-job-service.ts` with job lifecycle operations
    - Implement createJob, getJob, listJobs, updateJobStatus methods
    - Implement queueJob, processJob, validateJob, completeJob, failJob methods for job execution
    - Implement getJobProgress and getJobValidation methods for monitoring
    - Handle progress updates (0-100), validation errors array, and job status transitions
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [ ] 3.4 Create VisualTemplateService
    - Create `lib/db/services/visual-template-service.ts` with template operations
    - Implement createTemplate, getTemplate, listTemplates, updateTemplate, deleteTemplate methods
    - Implement validateLayoutConfig method to validate layout configuration structure
    - Implement applyTemplate method to apply template to data
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [~] 3.5 Create MigrationService
    - Create `lib/db/services/migration-service.ts` for data migration operations
    - Implement migrateProjects method to migrate Project to Workspace
    - Implement migrateSchemas method to migrate old Schema to SchemaDefinition
    - Implement migrateJobs method to migrate GenerationJob with new fields
    - Implement cleanupDeprecatedModels method to remove old collections
    - Implement validateMigration and rollbackMigration methods
    - Implement getMigrationStatus method for monitoring
    - _Requirements: All migration-related requirements_

- [~] 4. Checkpoint - Verify service layer
  - Ensure all service methods compile, verify TypeScript types are correct, ask the user if questions arise.

- [ ] 5. Update Database Query Layer
  - [~] 5.1 Update existing queries in lib/db/queries.ts
    - Update all references from "project" to "workspace"
    - Update query methods to use new Workspace model
    - Update GenerationJob queries to include new fields (progress, healthCheckPassed, validationErrors)
    - Add query methods for SchemaDefinition (getSchemasByWorkspace, getSchemaByIdAndVersion)
    - Add query methods for VisualTemplate (getTemplatesByUser, getPublicTemplates)
    - _Requirements: 5.4, 6.6, 7.12, 8.6_

  - [~] 5.2 Update Prisma client exports
    - Update `lib/db/prisma.ts` to export the updated Prisma client
    - Verify all new models are accessible through Prisma client
    - _Requirements: All schema requirements_

- [ ] 6. Update API Routes
  - [~] 6.1 Create Workspace API routes
    - Create `app/api/workspaces/route.ts` for GET (list) and POST (create) operations
    - Create `app/api/workspaces/[id]/route.ts` for GET (single), PATCH (update), DELETE operations
    - Use WorkspaceService for all database operations
    - Add proper authentication checks using NextAuth session
    - Return appropriate HTTP status codes and error messages
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [~] 6.2 Create SchemaDefinition API routes
    - Create `app/api/schemas/route.ts` for GET (list) and POST (create) operations
    - Create `app/api/schemas/[id]/route.ts` for GET, PATCH, DELETE operations
    - Create `app/api/schemas/[id]/versions/route.ts` for version management
    - Use SchemaDefinitionService for all operations
    - Validate table structure JSON before saving
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [~] 6.3 Update GenerationJob API routes
    - Update `app/api/jobs/route.ts` to use new GenerationJob fields
    - Update `app/api/jobs/[id]/route.ts` to include progress and validation data
    - Add endpoint for job progress updates: PATCH /api/jobs/[id]/progress
    - Add endpoint for job validation: POST /api/jobs/[id]/validate
    - Use GenerationJobService for all operations
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [~] 6.4 Create VisualTemplate API routes
    - Create `app/api/templates/route.ts` for GET (list) and POST (create) operations
    - Create `app/api/templates/[id]/route.ts` for GET, PATCH, DELETE operations
    - Add filtering for public templates: GET /api/templates?public=true
    - Use VisualTemplateService for all operations
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [~] 7. Checkpoint - Verify API routes
  - Ensure all API endpoints compile, verify authentication works, ask the user if questions arise.

- [ ] 8. Create Migration Script
  - [~] 8.1 Create database backup script
    - Create `scripts/backup-database.ts` to backup MongoDB database before migration
    - Export collections to JSON files
    - Store backup with timestamp
    - _Requirements: All migration requirements_

  - [~] 8.2 Create migration execution script
    - Create `scripts/migrate-schema.ts` to execute the full migration
    - Call MigrationService methods in correct order
    - Log progress and errors
    - Implement transaction safety where possible
    - _Requirements: All migration requirements_

  - [~] 8.3 Create rollback script
    - Create `scripts/rollback-migration.ts` to restore from backup if migration fails
    - Restore collections from backup JSON files
    - Verify data integrity after rollback
    - _Requirements: Migration rollback requirements_

- [ ] 9. Update UI Components
  - [~] 9.1 Update dashboard to use Workspace terminology
    - Update `app/(protected)/dashboard/page.tsx` to display "Workspaces" instead of "Projects"
    - Update all UI text from "project" to "workspace"
    - Update API calls to use new workspace endpoints
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [~] 9.2 Update job monitoring UI
    - Update job status display to show new statuses (QUEUED, PROCESSING, VALIDATING)
    - Add progress bar component to display job progress (0-100)
    - Add validation errors display component
    - Add health check status indicator
    - _Requirements: 7.4, 7.5, 7.8, 7.9_

- [ ] 10. Final Integration and Deployment
  - [~] 10.1 Run migration on staging database
    - Execute backup script
    - Execute migration script
    - Verify all data migrated correctly
    - Test all API endpoints with migrated data
    - _Requirements: All requirements_

  - [~] 10.2 Update environment variables and documentation
    - Update README.md with new schema information
    - Update API documentation with new endpoints
    - Add migration instructions to documentation
    - _Requirements: All requirements_

- [~] 11. Final checkpoint - Verify complete system
  - Ensure all tests pass, verify migration completed successfully, test all user workflows, ask the user if questions arise.

## Notes

- All database operations should use Prisma client for type safety
- Maintain NextAuth compatibility throughout all changes
- Use transactions for multi-step operations where possible
- All new API routes should include proper authentication checks
- Migration should be tested on development database before production
- Keep backups of production data before migration
- Monitor application logs after migration for any issues
- Each service should have proper error handling with meaningful error messages
- All JSON fields (tables, layoutConfig, validationErrors) should be validated before storage

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"] },
    { "id": 1, "tasks": ["1.8"] },
    { "id": 2, "tasks": ["1.9"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["3.5", "5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 6, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 7, "tasks": ["9.1", "9.2"] },
    { "id": 8, "tasks": ["10.1", "10.2"] }
  ]
}
```
