# Requirements Document

## Introduction

This feature transitions the DataForge application to the HackDataV2 Synthetic Data & Document Platform. The transition includes restructuring the MongoDB schema to support synthetic data generation with table definitions, validation, document templates, and enhanced job tracking. The system will support tabular, relational, and document data types with configurable null rates, foreign keys, and cardinality constraints.

## Glossary

- **Schema_Manager**: The Prisma client and database layer that manages schema definitions
- **Job_Processor**: The system component that processes data generation jobs
- **Validation_Engine**: The component that validates generated data against schema constraints
- **Template_System**: The component that manages visual document templates
- **Workspace**: A user's project container that holds schemas, jobs, and generated data
- **Schema_Definition**: A structured specification of tables, columns, constraints, and relationships for data generation
- **Data_Type**: The category of data being generated (tabular, relational, or document)
- **Export_Module**: The component that exports generated data in various formats
- **Health_Check**: A validation step that ensures generated data meets basic quality criteria

## Requirements

### Requirement 1: Update Export Format Enum

**User Story:** As a developer, I want updated export format options, so that the platform supports the required output formats.

#### Acceptance Criteria

1. THE Schema_Manager SHALL define an ExportFormat enum with values CSV, JSON, SQL, PDF, ZIP
2. WHEN an export job is created, THE Export_Module SHALL accept only valid ExportFormat values
3. THE Schema_Manager SHALL remove TYPESCRIPT and GRAPHQL from the ExportFormat enum

### Requirement 2: Update Job Status Enum

**User Story:** As a system administrator, I want granular job status tracking, so that I can monitor the generation pipeline stages.

#### Acceptance Criteria

1. THE Schema_Manager SHALL define a JobStatus enum with values QUEUED, PROCESSING, VALIDATING, COMPLETED, FAILED
2. WHEN a generation job transitions between states, THE Job_Processor SHALL update the status to reflect the current stage
3. THE Schema_Manager SHALL remove PENDING from the JobStatus enum

### Requirement 3: Add Data Type Enum

**User Story:** As a data architect, I want to specify the type of data being generated, so that the system can apply appropriate generation and validation rules.

#### Acceptance Criteria

1. THE Schema_Manager SHALL define a DataType enum with values TABULAR, RELATIONAL, DOCUMENT
2. WHEN a schema definition is created, THE Schema_Manager SHALL require a valid DataType value
3. THE Job_Processor SHALL apply type-specific generation logic based on the DataType value

### Requirement 4: Maintain User Model with NextAuth Compatibility

**User Story:** As an authenticated user, I want my account to work seamlessly with NextAuth, so that I can access the platform securely.

#### Acceptance Criteria

1. THE Schema_Manager SHALL maintain the existing User model structure with all NextAuth-required fields
2. THE Schema_Manager SHALL add a workspaces relation to the User model linking to Workspace entities
3. THE Schema_Manager SHALL preserve the existing accounts and sessions relations for NextAuth compatibility

### Requirement 5: Rename Project to Workspace

**User Story:** As a user, I want to organize my work in workspaces, so that I can manage multiple data generation projects.

#### Acceptance Criteria

1. THE Schema_Manager SHALL rename the Project model to Workspace
2. THE Workspace model SHALL contain fields: id, name, description, userId, createdAt, updatedAt
3. THE Schema_Manager SHALL maintain the userId foreign key relationship to User
4. THE Schema_Manager SHALL update all related model references from project to workspace

### Requirement 6: Create Schema Definition Model

**User Story:** As a data engineer, I want to define table structures with constraints, so that I can generate realistic synthetic data.

#### Acceptance Criteria

1. THE Schema_Manager SHALL create a SchemaDefinition model with fields: id, workspaceId, name, dataType, tables, version, createdAt, updatedAt
2. THE SchemaDefinition model SHALL store the workspaceId as a foreign key to Workspace
3. THE SchemaDefinition model SHALL store the dataType as a DataType enum value
4. THE SchemaDefinition model SHALL store tables as a BSON/Json field containing table structures, null rates, foreign keys, and cardinalities
5. THE SchemaDefinition model SHALL include a version field as an integer starting at 1
6. THE Schema_Manager SHALL create indexes on workspaceId, name, and version fields

### Requirement 7: Update Generation Job Model

**User Story:** As a job monitor, I want detailed job tracking with progress and validation results, so that I can diagnose generation issues.

#### Acceptance Criteria

1. THE Schema_Manager SHALL update GenerationJob with fields: id, workspaceId, schemaId, status, progress, rowCount, seed, locale, healthCheckPassed, validationErrors, exportUrl, fileSizeBytes, createdAt, completedAt
2. THE GenerationJob model SHALL store workspaceId as a foreign key to Workspace
3. THE GenerationJob model SHALL store schemaId as a foreign key to SchemaDefinition
4. THE GenerationJob model SHALL store status as a JobStatus enum value
5. THE GenerationJob model SHALL store progress as an integer representing percentage (0-100)
6. THE GenerationJob model SHALL store rowCount, seed, and fileSizeBytes as optional integers
7. THE GenerationJob model SHALL store locale as an optional string
8. THE GenerationJob model SHALL store healthCheckPassed as an optional boolean
9. THE GenerationJob model SHALL store validationErrors as a BSON/Json array
10. THE GenerationJob model SHALL store exportUrl as an optional string
11. THE GenerationJob model SHALL store completedAt as an optional DateTime
12. THE Schema_Manager SHALL create indexes on workspaceId, schemaId, status, and createdAt fields

### Requirement 8: Create Visual Template Model

**User Story:** As a document designer, I want to create reusable visual templates, so that I can generate formatted documents consistently.

#### Acceptance Criteria

1. THE Schema_Manager SHALL create a VisualTemplate model with fields: id, userId, name, category, layoutConfig, isPublic, createdAt, updatedAt
2. THE VisualTemplate model SHALL store userId as a foreign key to User
3. THE VisualTemplate model SHALL store category as an optional string
4. THE VisualTemplate model SHALL store layoutConfig as a BSON/Json field containing layout specifications
5. THE VisualTemplate model SHALL store isPublic as a boolean defaulting to false
6. THE Schema_Manager SHALL create indexes on userId, category, and isPublic fields

### Requirement 9: Update Validation Result Model

**User Story:** As a quality assurance engineer, I want structured validation results with error details, so that I can identify data quality issues.

#### Acceptance Criteria

1. THE Schema_Manager SHALL maintain ValidationResult with fields: id, jobId, summary, isPassed, errors, createdAt, updatedAt
2. THE ValidationResult model SHALL store errors as a BSON/Json array containing error objects
3. THE ValidationResult model SHALL maintain the existing jobId foreign key to GenerationJob
4. THE Schema_Manager SHALL maintain indexes on jobId and isPassed fields

### Requirement 10: Remove Deprecated Models

**User Story:** As a developer, I want a clean schema without unused models, so that the codebase remains maintainable.

#### Acceptance Criteria

1. THE Schema_Manager SHALL remove the Dataset model from the schema
2. THE Schema_Manager SHALL remove the Schema model from the schema (replaced by SchemaDefinition)
3. THE Schema_Manager SHALL remove the Template model from the schema (replaced by VisualTemplate)
4. THE Schema_Manager SHALL remove the AIConversation model from the schema
5. THE Schema_Manager SHALL remove the ExportLog model from the schema

### Requirement 11: Update TypeScript Type Definitions

**User Story:** As a TypeScript developer, I want type definitions that match the database schema, so that I can write type-safe code.

#### Acceptance Criteria

1. THE Schema_Manager SHALL generate TypeScript types in types/database.ts that mirror all updated Prisma models
2. THE Schema_Manager SHALL define TableStructure interface with fields for table definitions including name, columns, nullRates, foreignKeys, and cardinalities
3. THE Schema_Manager SHALL define ColumnDefinition interface with fields: name, type, nullable, primaryKey, defaultValue, constraints
4. THE Schema_Manager SHALL define ForeignKeyConstraint interface with fields: fromColumn, toTable, toColumn, onDelete, onUpdate
5. THE Schema_Manager SHALL define ValidationError interface with fields: field, message, severity, code
6. THE Schema_Manager SHALL define LayoutConfig interface for VisualTemplate layout specifications
7. THE Schema_Manager SHALL export all enum types from Prisma client
8. THE Schema_Manager SHALL provide Prisma payload types for all models with common relation includes

### Requirement 12: Parse and Format Schema Definitions

**User Story:** As a schema designer, I want to define schemas in a structured format, so that the generation engine can parse them correctly.

#### Acceptance Criteria

1. THE Schema_Manager SHALL provide TypeScript interfaces for parsing table structure JSON
2. THE Schema_Manager SHALL validate that table structures contain required fields before storage
3. FOR ALL valid SchemaDefinition objects, parsing the tables field then formatting it then parsing again SHALL produce an equivalent object (round-trip property)

## Notes

- This transition maintains backward compatibility with NextAuth authentication
- All MongoDB ObjectId fields use the @db.ObjectId decorator
- BSON fields are represented as Json type in Prisma schema
- The migration will require a database migration script to rename existing collections and transform data
- Existing user accounts and sessions will be preserved during migration
