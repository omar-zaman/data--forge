# Technical Design Document: MongoDB Schema Transition

## Overview

This design implements the transition from the current DataForge schema to the HackDataV2 Synthetic Data & Document Platform schema. The transition restructures the MongoDB database to support synthetic data generation with comprehensive table definitions, validation tracking, and visual document templates.

### Design Goals

1. **Schema Modernization**: Restructure the database schema to support synthetic data generation workflows
2. **Type Safety**: Maintain strong TypeScript type definitions that mirror the database schema
3. **Backward Compatibility**: Preserve NextAuth integration and existing user authentication
4. **Data Integrity**: Ensure referential integrity through proper foreign key relationships
5. **Migration Safety**: Provide a clear migration path from existing schema to new schema

### Key Design Decisions

- **Workspace Terminology**: Renamed "Project" to "Workspace" to better reflect the organizational unit for data generation work
- **Schema Definition Separation**: Created dedicated SchemaDefinition model to separate schema structure from legacy Schema model
- **Job Status Granularity**: Enhanced job status tracking with QUEUED, PROCESSING, VALIDATING states for better monitoring
- **Template System Redesign**: Replaced generic Template model with VisualTemplate model focused on document layout
- **Model Cleanup**: Removed deprecated models (Dataset, AIConversation, ExportLog) to streamline the schema

## Architecture

### Database Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Prisma Client Layer                       │
│  • Type-safe queries                                         │
│  • Automatic migrations                                      │
│  • Relation management                                       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    MongoDB Database                          │
│                                                              │
│  ┌──────────┐    ┌───────────┐    ┌──────────────────┐    │
│  │  users   │───▶│workspaces │───▶│schema_definitions│    │
│  └──────────┘    └───────────┘    └──────────────────┘    │
│                         │                    │              │
│                         ▼                    ▼              │
│                  ┌──────────────┐   ┌────────────────┐    │
│                  │generation_jobs│◀──│validation_results│   │
│                  └──────────────┘   └────────────────┘    │
│                                                              │
│  ┌────────────┐   ┌──────────┐   ┌──────────────────┐    │
│  │  accounts  │   │ sessions │   │visual_templates  │    │
│  └────────────┘   └──────────┘   └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Architecture

```
User Request
    │
    ▼
┌─────────────────┐
│  Create Schema  │──────┐
└─────────────────┘      │
                         ▼
                  ┌─────────────────┐
                  │Schema Definition│
                  │    Storage      │
                  └─────────────────┘
                         │
                         ▼
┌─────────────────┐    ┌────────────────┐
│ Create Gen Job  │───▶│  Job Processor │
└─────────────────┘    └────────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │  Generation  │
                       │    Engine    │
                       └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │  Validation  │
                       │    Engine    │
                       └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │    Export    │
                       │    Module    │
                       └──────────────┘
```

## Components and Interfaces

### 1. Schema Manager Component

**Responsibility**: Manages Prisma schema definition and database migrations

**Key Operations**:
- Define and update Prisma models
- Generate TypeScript types from schema
- Execute database migrations
- Maintain referential integrity

**Interface**:
```typescript
interface ISchemaManager {
  // Migration operations
  generateMigration(name: string): Promise<void>;
  applyMigration(): Promise<void>;
  rollbackMigration(): Promise<void>;
  
  // Schema validation
  validateSchema(): Promise<ValidationResult>;
  generateTypes(): Promise<void>;
}
```

### 2. Workspace Service Component

**Responsibility**: CRUD operations for Workspace entities

**Interface**:
```typescript
interface IWorkspaceService {
  // Workspace operations
  createWorkspace(userId: string, data: CreateWorkspaceInput): Promise<Workspace>;
  getWorkspace(id: string): Promise<WorkspaceWithRelations | null>;
  listWorkspaces(userId: string, filters?: WorkspaceFilters): Promise<Workspace[]>;
  updateWorkspace(id: string, data: UpdateWorkspaceInput): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;
  
  // Relation queries
  getWorkspaceWithSchemas(id: string): Promise<WorkspaceWithSchemas | null>;
  getWorkspaceWithJobs(id: string): Promise<WorkspaceWithJobs | null>;
}
```

### 3. Schema Definition Service Component

**Responsibility**: Manages schema definitions for data generation

**Interface**:
```typescript
interface ISchemaDefinitionService {
  // Schema definition CRUD
  createSchema(data: CreateSchemaDefinitionInput): Promise<SchemaDefinition>;
  getSchema(id: string): Promise<SchemaDefinition | null>;
  listSchemas(workspaceId: string): Promise<SchemaDefinition[]>;
  updateSchema(id: string, data: UpdateSchemaDefinitionInput): Promise<SchemaDefinition>;
  deleteSchema(id: string): Promise<void>;
  
  // Schema validation
  validateTableStructure(tables: TableStructure[]): ValidationResult;
  parseTables(tablesJson: unknown): TableStructure[];
  formatTables(tables: TableStructure[]): unknown;
  
  // Version management
  createNewVersion(schemaId: string): Promise<SchemaDefinition>;
  listVersions(workspaceId: string, name: string): Promise<SchemaDefinition[]>;
}
```

### 4. Generation Job Service Component

**Responsibility**: Manages data generation job lifecycle

**Interface**:
```typescript
interface IGenerationJobService {
  // Job lifecycle
  createJob(data: CreateGenerationJobInput): Promise<GenerationJob>;
  getJob(id: string): Promise<GenerationJobWithRelations | null>;
  listJobs(filters: GenerationJobFilters): Promise<GenerationJob[]>;
  updateJobStatus(id: string, status: JobStatus, progress?: number): Promise<void>;
  
  // Job execution
  queueJob(jobId: string): Promise<void>;
  processJob(jobId: string): Promise<void>;
  validateJob(jobId: string): Promise<ValidationResult>;
  completeJob(jobId: string, exportUrl: string): Promise<void>;
  failJob(jobId: string, errors: ValidationError[]): Promise<void>;
  
  // Job monitoring
  getJobProgress(jobId: string): Promise<number>;
  getJobValidation(jobId: string): Promise<ValidationResult | null>;
}
```

### 5. Visual Template Service Component

**Responsibility**: Manages document template definitions

**Interface**:
```typescript
interface IVisualTemplateService {
  // Template CRUD
  createTemplate(data: CreateVisualTemplateInput): Promise<VisualTemplate>;
  getTemplate(id: string): Promise<VisualTemplate | null>;
  listTemplates(filters: TemplateFilters): Promise<VisualTemplate[]>;
  updateTemplate(id: string, data: UpdateVisualTemplateInput): Promise<VisualTemplate>;
  deleteTemplate(id: string): Promise<void>;
  
  // Template operations
  validateLayoutConfig(config: LayoutConfig): ValidationResult;
  applyTemplate(templateId: string, data: unknown): Promise<string>;
}
```

### 6. Migration Service Component

**Responsibility**: Handles data migration from old schema to new schema

**Interface**:
```typescript
interface IMigrationService {
  // Migration execution
  migrateProjects(): Promise<MigrationResult>;
  migrateSchemas(): Promise<MigrationResult>;
  migrateJobs(): Promise<MigrationResult>;
  cleanupDeprecatedModels(): Promise<void>;
  
  // Migration validation
  validateMigration(): Promise<ValidationResult>;
  rollbackMigration(): Promise<void>;
  
  // Migration status
  getMigrationStatus(): Promise<MigrationStatus>;
}
```

## Data Models

### Updated Prisma Schema

The complete Prisma schema will be defined in `prisma/schema.prisma`. Key model updates:

#### Enums

```prisma
enum UserRole {
  USER
  ADMIN
  DEVELOPER
}

enum JobStatus {
  QUEUED
  PROCESSING
  VALIDATING
  COMPLETED
  FAILED
}

enum ExportFormat {
  CSV
  JSON
  SQL
  PDF
  ZIP
}

enum DataType {
  TABULAR
  RELATIONAL
  DOCUMENT
}
```

#### Core Models

**User Model** (unchanged, maintains NextAuth compatibility):
```prisma
model User {
  id            String    @id @default(auto()) @map("_id") @db.ObjectId
  email         String    @unique
  emailVerified DateTime?
  name          String?
  image         String?
  password      String?
  role          UserRole  @default(USER)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  workspaces      Workspace[]
  visualTemplates VisualTemplate[]
  accounts        Account[]
  sessions        Session[]

  @@index([role])
  @@map("users")
}
```

**Workspace Model** (renamed from Project):
```prisma
model Workspace {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  name        String
  description String?
  userId      String   @db.ObjectId
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user              User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  schemaDefinitions SchemaDefinition[]
  generationJobs    GenerationJob[]

  @@index([userId])
  @@index([createdAt])
  @@map("workspaces")
}
```

**SchemaDefinition Model** (new):
```prisma
model SchemaDefinition {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  name        String
  dataType    DataType
  tables      Json     @default("[]")
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace      Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  generationJobs GenerationJob[]

  @@index([workspaceId])
  @@index([name])
  @@index([version])
  @@map("schema_definitions")
}
```

**GenerationJob Model** (updated):
```prisma
model GenerationJob {
  id                String    @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId       String    @db.ObjectId
  schemaId          String    @db.ObjectId
  status            JobStatus @default(QUEUED)
  progress          Int       @default(0)
  rowCount          Int?
  seed              Int?
  locale            String?
  healthCheckPassed Boolean?
  validationErrors  Json      @default("[]")
  exportUrl         String?
  fileSizeBytes     Int?
  createdAt         DateTime  @default(now())
  completedAt       DateTime?
  updatedAt         DateTime  @updatedAt

  workspace         Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  schema            SchemaDefinition   @relation(fields: [schemaId], references: [id], onDelete: Restrict)
  validationResults ValidationResult[]

  @@index([workspaceId])
  @@index([schemaId])
  @@index([status])
  @@index([createdAt])
  @@map("generation_jobs")
}
```

**VisualTemplate Model** (new):
```prisma
model VisualTemplate {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  userId       String   @db.ObjectId
  name         String
  category     String?
  layoutConfig Json     @default("{}")
  isPublic     Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([category])
  @@index([isPublic])
  @@map("visual_templates")
}
```

**ValidationResult Model** (updated):
```prisma
model ValidationResult {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  jobId     String   @db.ObjectId
  summary   Json     @default("{}")
  isPassed  Boolean  @default(false)
  errors    Json     @default("[]")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  job GenerationJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId])
  @@index([isPassed])
  @@map("validation_results")
}
```

### TypeScript Type Definitions

The complete type definitions will be in `types/database.ts`:

```typescript
// ============================================
// Workspace Types
// ============================================

export type Workspace = Prisma.WorkspaceGetPayload<{}>;
export type WorkspaceWithRelations = Prisma.WorkspaceGetPayload<{
  include: {
    user: true;
    schemaDefinitions: true;
    generationJobs: true;
  };
}>;
export type WorkspaceWithSchemas = Prisma.WorkspaceGetPayload<{
  include: { schemaDefinitions: true };
}>;
export type WorkspaceWithJobs = Prisma.WorkspaceGetPayload<{
  include: { generationJobs: true };
}>;

export type CreateWorkspaceInput = Prisma.WorkspaceCreateInput;
export type UpdateWorkspaceInput = Prisma.WorkspaceUpdateInput;

// ============================================
// Schema Definition Types
// ============================================

export type SchemaDefinition = Prisma.SchemaDefinitionGetPayload<{}>;
export type SchemaDefinitionWithRelations = Prisma.SchemaDefinitionGetPayload<{
  include: {
    workspace: true;
    generationJobs: true;
  };
}>;

export type CreateSchemaDefinitionInput = Prisma.SchemaDefinitionCreateInput;
export type UpdateSchemaDefinitionInput = Prisma.SchemaDefinitionUpdateInput;

// Table structure interfaces
export interface TableStructure {
  name: string;
  columns: ColumnDefinition[];
  nullRates?: Record<string, number>;
  foreignKeys?: ForeignKeyConstraint[];
  cardinalities?: Record<string, CardinalityConstraint>;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  defaultValue?: unknown;
  constraints?: ColumnConstraint[];
}

export interface ForeignKeyConstraint {
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT' | 'NO_ACTION';
  onUpdate?: 'CASCADE' | 'SET_NULL' | 'RESTRICT' | 'NO_ACTION';
}

export interface CardinalityConstraint {
  relationship: 'oneToOne' | 'oneToMany' | 'manyToMany';
  targetTable: string;
  minRecords?: number;
  maxRecords?: number;
}

export interface ColumnConstraint {
  type: 'UNIQUE' | 'CHECK' | 'DEFAULT' | 'NOT_NULL';
  value?: unknown;
}

// ============================================
// Generation Job Types
// ============================================

export type GenerationJob = Prisma.GenerationJobGetPayload<{}>;
export type GenerationJobWithRelations = Prisma.GenerationJobGetPayload<{
  include: {
    workspace: true;
    schema: true;
    validationResults: true;
  };
}>;

export type CreateGenerationJobInput = Prisma.GenerationJobCreateInput;
export type UpdateGenerationJobInput = Prisma.GenerationJobUpdateInput;

// ============================================
// Visual Template Types
// ============================================

export type VisualTemplate = Prisma.VisualTemplateGetPayload<{}>;
export type VisualTemplateWithUser = Prisma.VisualTemplateGetPayload<{
  include: { user: true };
}>;

export type CreateVisualTemplateInput = Prisma.VisualTemplateCreateInput;
export type UpdateVisualTemplateInput = Prisma.VisualTemplateUpdateInput;

export interface LayoutConfig {
  pageSize?: 'A4' | 'LETTER' | 'LEGAL';
  orientation?: 'portrait' | 'landscape';
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  sections?: LayoutSection[];
  fonts?: FontConfig[];
  colors?: ColorPalette;
}

export interface LayoutSection {
  id: string;
  type: 'header' | 'body' | 'footer' | 'table' | 'chart' | 'text';
  position: { x: number; y: number; width: number; height: number };
  style?: Record<string, unknown>;
  content?: unknown;
}

export interface FontConfig {
  family: string;
  size: number;
  weight?: 'normal' | 'bold' | 'lighter' | 'bolder';
  style?: 'normal' | 'italic' | 'oblique';
}

export interface ColorPalette {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  text?: string;
}

// ============================================
// Validation Types
// ============================================

export type ValidationResult = Prisma.ValidationResultGetPayload<{}>;
export type ValidationResultWithJob = Prisma.ValidationResultGetPayload<{
  include: { job: true };
}>;

export type CreateValidationResultInput = Prisma.ValidationResultCreateInput;
export type UpdateValidationResultInput = Prisma.ValidationResultUpdateInput;

export interface ValidationError {
  field?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code?: string;
}

// ============================================
// Filter Types
// ============================================

export interface WorkspaceFilters {
  userId?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface GenerationJobFilters {
  workspaceId?: string;
  schemaId?: string;
  status?: JobStatus[];
  dateFrom?: Date;
  dateTo?: Date;
}

export interface TemplateFilters {
  userId?: string;
  category?: string;
  isPublic?: boolean;
  search?: string;
}

// ============================================
// Enums
// ============================================

export { UserRole, JobStatus, ExportFormat, DataType } from '@prisma/client';
```

## Error Handling

### Error Categories

1. **Validation Errors**: Schema structure validation failures
2. **Database Errors**: MongoDB connection and query errors
3. **Migration Errors**: Data migration failures
4. **Generation Errors**: Job processing and data generation failures
5. **Export Errors**: Data export and file creation failures

### Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
  };
}

// Example error codes
enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  SCHEMA_NOT_FOUND = 'SCHEMA_NOT_FOUND',
  WORKSPACE_NOT_FOUND = 'WORKSPACE_NOT_FOUND',
  JOB_CREATION_FAILED = 'JOB_CREATION_FAILED',
  MIGRATION_FAILED = 'MIGRATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  DATABASE_ERROR = 'DATABASE_ERROR',
}
```

### Error Handling Strategy

1. **Graceful Degradation**: Services should handle partial failures gracefully
2. **Transaction Safety**: Use database transactions for multi-step operations
3. **Rollback Support**: Migration operations must be reversible
4. **Error Logging**: Log all errors with context for debugging
5. **User Feedback**: Provide clear, actionable error messages to users

## Testing Strategy

This feature involves database schema changes and data transformations, which are best tested through integration tests and example-based unit tests rather than property-based testing.

### Testing Approach

#### 1. Unit Tests
Focus on specific examples and edge cases for:
- Schema validation logic
- Type parsing and formatting
- Job status transitions
- Error handling scenarios

**Example Test Cases**:
```typescript
describe('SchemaDefinitionService', () => {
  it('should validate table structure with valid columns', () => {
    const tables: TableStructure[] = [{
      name: 'users',
      columns: [
        { name: 'id', type: 'string', primaryKey: true },
        { name: 'email', type: 'string', nullable: false }
      ]
    }];
    
    const result = service.validateTableStructure(tables);
    expect(result.isValid).toBe(true);
  });

  it('should reject table structure with missing primary key', () => {
    const tables: TableStructure[] = [{
      name: 'users',
      columns: [
        { name: 'email', type: 'string', nullable: false }
      ]
    }];
    
    const result = service.validateTableStructure(tables);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Table must have a primary key');
  });

  it('should reject invalid foreign key references', () => {
    const tables: TableStructure[] = [{
      name: 'posts',
      columns: [
        { name: 'id', type: 'string', primaryKey: true },
        { name: 'userId', type: 'string' }
      ],
      foreignKeys: [{
        fromColumn: 'userId',
        toTable: 'nonexistent_table',
        toColumn: 'id'
      }]
    }];
    
    const result = service.validateTableStructure(tables);
    expect(result.isValid).toBe(false);
  });
});
```

#### 2. Integration Tests
Test database operations end-to-end:
- CRUD operations for all models
- Foreign key constraint enforcement
- Cascade delete behavior
- Transaction rollback scenarios
- Migration execution

**Example Integration Tests**:
```typescript
describe('Workspace Integration', () => {
  it('should create workspace with user relationship', async () => {
    const user = await prisma.user.create({
      data: { email: 'test@example.com', name: 'Test User' }
    });
    
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        description: 'A test workspace',
        userId: user.id
      }
    });
    
    expect(workspace.userId).toBe(user.id);
  });

  it('should cascade delete workspace when user is deleted', async () => {
    const user = await prisma.user.create({
      data: { email: 'test@example.com', name: 'Test User' }
    });
    
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        userId: user.id
      }
    });
    
    await prisma.user.delete({ where: { id: user.id } });
    
    const deletedWorkspace = await prisma.workspace.findUnique({
      where: { id: workspace.id }
    });
    
    expect(deletedWorkspace).toBeNull();
  });
});
```

#### 3. Migration Tests
Verify data migration correctness:
- Old schema data is preserved
- Foreign key relationships are maintained
- Enum value mappings are correct
- No data loss during migration

**Example Migration Tests**:
```typescript
describe('Schema Migration', () => {
  it('should migrate Project to Workspace preserving all data', async () => {
    // Setup: Create old schema data
    const oldProject = await prisma.project.create({
      data: {
        name: 'Old Project',
        description: 'Test project',
        userId: testUserId
      }
    });
    
    // Execute migration
    await migrationService.migrateProjects();
    
    // Verify: Check new schema data
    const newWorkspace = await prisma.workspace.findFirst({
      where: { name: 'Old Project' }
    });
    
    expect(newWorkspace).toBeDefined();
    expect(newWorkspace?.name).toBe(oldProject.name);
    expect(newWorkspace?.description).toBe(oldProject.description);
    expect(newWorkspace?.userId).toBe(oldProject.userId);
  });
});
```

#### 4. Schema Validation Tests
Test Prisma schema constraints:
- Unique constraints
- Index creation
- Default values
- Field types

#### 5. Type Safety Tests
Verify TypeScript type definitions:
- Type exports match Prisma schema
- Interface definitions are complete
- Enum values are correct

### Test Coverage Goals

- **Unit Tests**: 80%+ coverage for service logic
- **Integration Tests**: All CRUD operations and relationships
- **Migration Tests**: All data transformation paths
- **E2E Tests**: Critical user workflows (create workspace → create schema → create job)

### Testing Tools

- **Jest**: Test runner and assertion library
- **Prisma Test Environment**: In-memory database for integration tests
- **MongoDB Memory Server**: Isolated MongoDB instance for testing
- **Supertest**: HTTP endpoint testing (if applicable)

## Migration Strategy

### Migration Phases

#### Phase 1: Schema Preparation
1. Create new Prisma schema file with updated models
2. Generate migration SQL
3. Review migration for data safety
4. Backup production database

#### Phase 2: Schema Deployment
1. Apply Prisma migration to create new collections
2. Verify new collections are created
3. Verify indexes are created correctly

#### Phase 3: Data Migration
1. Migrate User data (no changes needed)
2. Migrate Project → Workspace
3. Migrate Schema → SchemaDefinition
4. Migrate GenerationJob with new fields
5. Migrate ValidationResult with new fields
6. Migrate Template → VisualTemplate (if applicable)

#### Phase 4: Cleanup
1. Verify all data migrated successfully
2. Drop deprecated collections (Dataset, AIConversation, ExportLog)
3. Update application code to use new models
4. Deploy updated application

#### Phase 5: Validation
1. Run integration tests against migrated database
2. Verify all user accounts work
3. Verify existing workspaces are accessible
4. Monitor for errors

### Migration Script Structure

```typescript
// migration-script.ts

async function migrateSchema() {
  console.log('Starting schema migration...');
  
  // Phase 1: Migrate Projects to Workspaces
  const projects = await oldPrisma.project.findMany();
  for (const project of projects) {
    await newPrisma.workspace.create({
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        userId: project.userId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      }
    });
  }
  console.log(`Migrated ${projects.length} projects to workspaces`);
  
  // Phase 2: Migrate Schemas to SchemaDefinitions
  const schemas = await oldPrisma.schema.findMany();
  for (const schema of schemas) {
    await newPrisma.schemaDefinition.create({
      data: {
        workspaceId: schema.projectId,
        name: `Schema v${schema.version}`,
        dataType: 'TABULAR', // Default type
        tables: schema.structure,
        version: schema.version,
        createdAt: schema.createdAt,
        updatedAt: schema.updatedAt,
      }
    });
  }
  console.log(`Migrated ${schemas.length} schemas to schema definitions`);
  
  // Phase 3: Migrate Generation Jobs
  const jobs = await oldPrisma.generationJob.findMany();
  for (const job of jobs) {
    const newStatus = mapOldStatusToNew(job.status);
    await newPrisma.generationJob.create({
      data: {
        workspaceId: job.projectId,
        schemaId: job.schemaId || getDefaultSchemaId(job.projectId),
        status: newStatus,
        progress: calculateProgress(job.status),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }
    });
  }
  console.log(`Migrated ${jobs.length} generation jobs`);
  
  console.log('Migration completed successfully!');
}

function mapOldStatusToNew(oldStatus: string): JobStatus {
  const statusMap: Record<string, JobStatus> = {
    'PENDING': 'QUEUED',
    'PROCESSING': 'PROCESSING',
    'COMPLETED': 'COMPLETED',
    'FAILED': 'FAILED',
  };
  return statusMap[oldStatus] || 'QUEUED';
}

function calculateProgress(status: string): number {
  if (status === 'COMPLETED') return 100;
  if (status === 'PROCESSING') return 50;
  return 0;
}
```

### Rollback Plan

If migration fails:
1. Stop application
2. Restore database from backup
3. Revert Prisma schema to previous version
4. Redeploy previous application version
5. Investigate migration failure
6. Fix issues and retry migration

## Implementation Plan

### Step 1: Update Prisma Schema
- Update `prisma/schema.prisma` with new models and enums
- Remove deprecated models
- Add proper indexes and relations

### Step 2: Generate Types
- Run Prisma generate to create TypeScript types
- Update `types/database.ts` with custom interfaces
- Export all necessary types

### Step 3: Create Migration
- Run `npx prisma migrate dev` to create migration
- Review migration SQL
- Test migration on development database

### Step 4: Update Service Layer
- Create new service files for Workspace, SchemaDefinition, VisualTemplate
- Update existing services to use new models
- Implement validation logic

### Step 5: Update API Routes
- Update API endpoints to use new models
- Add new endpoints for SchemaDefinition and VisualTemplate
- Update request/response types

### Step 6: Write Tests
- Write unit tests for services
- Write integration tests for database operations
- Write migration tests

### Step 7: Execute Migration
- Backup production database
- Run migration script
- Verify data integrity
- Deploy updated application

### Step 8: Monitor and Validate
- Monitor application logs
- Verify user workflows
- Check database performance
- Address any issues

## Conclusion

This design provides a comprehensive approach to transitioning the DataForge schema to support the HackDataV2 Synthetic Data & Document Platform. The design emphasizes:

- **Type Safety**: Strong TypeScript types throughout
- **Data Integrity**: Proper foreign key relationships and constraints
- **Migration Safety**: Phased migration with rollback support
- **Testing**: Comprehensive test coverage for reliability
- **Maintainability**: Clean separation of concerns and clear interfaces

The implementation will be executed in phases to minimize risk and ensure a smooth transition from the current schema to the new schema.
