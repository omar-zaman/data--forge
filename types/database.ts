/**
 * Database Types
 * Type definitions inferred from Prisma schema for HackDataV2 Synthetic Data & Document Platform
 */
import type { Prisma } from "@prisma/client";

// ============================================
// Enum re-exports
// ============================================

export { UserRole, JobStatus, DataType } from "@prisma/client";

// ============================================
// User Types
// ============================================

export type User = Prisma.UserGetPayload<Record<string, never>>;
export type UserWithRelations = Prisma.UserGetPayload<{
  include: {
    workspaces: true;
    visualTemplates: true;
  };
}>;

export type CreateUserInput = Prisma.UserCreateInput;
export type UpdateUserInput = Prisma.UserUpdateInput;

// ============================================
// Workspace Types
// ============================================

export type Workspace = Prisma.WorkspaceGetPayload<Record<string, never>>;
export type WorkspaceWithRelations = Prisma.WorkspaceGetPayload<{
  include: {
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

export type SchemaDefinition = Prisma.SchemaDefinitionGetPayload<Record<string, never>>;
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
  onDelete?: "CASCADE" | "SET_NULL" | "RESTRICT" | "NO_ACTION";
  onUpdate?: "CASCADE" | "SET_NULL" | "RESTRICT" | "NO_ACTION";
}

export interface CardinalityConstraint {
  relationship: "oneToOne" | "oneToMany" | "manyToMany";
  targetTable: string;
  minRecords?: number;
  maxRecords?: number;
}

export interface ColumnConstraint {
  type: "UNIQUE" | "CHECK" | "DEFAULT" | "NOT_NULL";
  value?: unknown;
}

// ============================================
// Generation Job Types
// ============================================

export type GenerationJob = Prisma.GenerationJobGetPayload<Record<string, never>>;
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
// Validation Result Types
// ============================================

export type ValidationResult = Prisma.ValidationResultGetPayload<Record<string, never>>;
export type ValidationResultWithJob = Prisma.ValidationResultGetPayload<{
  include: { job: true };
}>;

export type CreateValidationResultInput = Prisma.ValidationResultCreateInput;
export type UpdateValidationResultInput = Prisma.ValidationResultUpdateInput;

export interface ValidationError {
  field?: string;
  message: string;
  severity: "error" | "warning" | "info";
  code?: string;
}

// ============================================
// Visual Template Types
// ============================================

export type VisualTemplate = Prisma.VisualTemplateGetPayload<Record<string, never>>;
export type VisualTemplateWithUser = Prisma.VisualTemplateGetPayload<{
  include: { user: true };
}>;

export type CreateVisualTemplateInput = Prisma.VisualTemplateCreateInput;
export type UpdateVisualTemplateInput = Prisma.VisualTemplateUpdateInput;

export interface LayoutConfig {
  pageSize?: "A4" | "LETTER" | "LEGAL";
  orientation?: "portrait" | "landscape";
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  sections?: LayoutSection[];
  fonts?: FontConfig[];
  colors?: ColorPalette;
  // Document templates (see lib/validations/document-template.ts). When
  // documentType is set, every key below is required and strictly validated.
  documentType?: import("@/lib/validations/document-template").DocumentType;
  mappingKeys?: string[];
  layoutStyle?: import("@/lib/validations/document-template").DocumentLayoutStyle;
  currency?: string;
  branding?: import("@/lib/validations/document-template").DocumentBranding;
  typography?: import("@/lib/validations/document-template").DocumentTypography;
}

export interface LayoutSection {
  id: string;
  type: "header" | "body" | "footer" | "table" | "chart" | "text";
  position: { x: number; y: number; width: number; height: number };
  style?: Record<string, unknown>;
  content?: unknown;
}

export interface FontConfig {
  family: string;
  size: number;
  weight?: "normal" | "bold" | "lighter" | "bolder";
  style?: "normal" | "italic" | "oblique";
}

export interface ColorPalette {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  text?: string;
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
  status?: import("@prisma/client").JobStatus[];
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
// Pagination & Response Helpers
// ============================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================
// Migration Types
// ============================================

export interface MigrationResult {
  success: boolean;
  migratedCount: number;
  errors: string[];
}

export interface MigrationStatus {
  phase: string;
  progress: number;
  completedAt?: Date;
  errors: string[];
}