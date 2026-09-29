# Database Architecture - Prisma + MongoDB

## Overview

DataForge uses Prisma ORM with MongoDB for type-safe database operations and flexible document storage.

## Setup

### 1. Install Dependencies

```bash
npm install -D prisma
npm install @prisma/client
```

### 2. Configure Database Connection

Create a `.env` file in the project root:

```env
DATABASE_URL="mongodb://localhost:27017/dataforge"
```

### Local MongoDB Setup Options

#### Option A: Docker (Recommended)
```bash
docker run --name dataforge-mongodb \
  -p 27017:27017 \
  -d mongo:7
```

#### Option B: MongoDB Atlas (Cloud)
1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free cluster
3. Get connection string
4. Update `.env`:
```env
DATABASE_URL="mongodb+srv://username:password@cluster.mongodb.net/dataforge?retryWrites=true&w=majority"
```

#### Option C: Local Installation
- Windows: Download from https://www.mongodb.com/try/download/community
- macOS: `brew install mongodb-community`
- Linux: Follow official guides

### 3. Generate Prisma Client

```bash
npm run db:generate
```

### 4. Push Schema to MongoDB

For development (no migrations needed with MongoDB):
```bash
npm run db:push
```

### 5. Seed the Database (Optional)

```bash
npm run db:seed
```

## MongoDB with Prisma

### Key Differences from SQL Databases

1. **No Migrations**: MongoDB is schema-less, use `prisma db push` instead of migrations
2. **ObjectId**: MongoDB uses ObjectId for primary keys instead of CUID
3. **Flexible Schema**: JSON fields work natively without extra configuration
4. **Embedded Documents**: Can store complex nested data easily
5. **No Joins**: Prisma handles relations, but queries are different under the hood

## Database Schema

### Entities

#### **User**
- Authentication and user management
- Roles: USER, ADMIN, DEVELOPER
- Relations: Projects, AI Conversations

#### **Project**
- Main container for generated applications
- Belongs to a User
- Has: Datasets, Schemas, Generation Jobs, AI Conversations, Export Logs

#### **Dataset**
- Stores uploaded data files and metadata
- Linked to Projects
- JSON metadata for flexibility

#### **Schema**
- Database schema definitions
- Versioned for tracking changes
- JSON structure for flexibility

#### **GenerationJob**
- Tracks code generation tasks
- Statuses: PENDING, PROCESSING, COMPLETED, FAILED
- Stores metrics (duration, files, LOC, tokens)

#### **ValidationResult**
- Quality checks for generated code
- Linked to Generation Jobs
- Pass/fail status with detailed summary

#### **Template**
- Reusable project templates
- Public/private visibility
- Framework-agnostic structure

#### **AIConversation**
- Chat history with AI assistant
- Linked to Projects and Users
- Messages stored as JSON array

#### **ExportLog**
- Tracks code exports
- Formats: JSON, CSV, SQL, TypeScript, GraphQL
- File path tracking

## Usage Examples

### Basic Queries

```typescript
import prisma from "@/lib/db/prisma";

// Create a user
const user = await prisma.user.create({
  data: {
    email: "user@example.com",
    name: "John Doe",
    role: "USER",
  },
});

// Get user with projects
const userWithProjects = await prisma.user.findUnique({
  where: { id: userId },
  include: { projects: true },
});

// Create a project
const project = await prisma.project.create({
  data: {
    name: "My App",
    description: "A new application",
    userId: user.id,
  },
});

// Query with filters
const recentJobs = await prisma.generationJob.findMany({
  where: {
    status: "COMPLETED",
    createdAt: {
      gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
    },
  },
  include: {
    project: true,
    validationResults: true,
  },
  orderBy: {
    createdAt: "desc",
  },
  take: 10,
});
```

### Using Type-Safe Types

```typescript
import type {
  User,
  Project,
  ProjectWithRelations,
  CreateProjectInput,
} from "@/types/database";

// Function with proper types
async function createProject(input: CreateProjectInput): Promise<Project> {
  return await prisma.project.create({ data: input });
}

// Use the inferred types
const project: ProjectWithRelations = await prisma.project.findUnique({
  where: { id: projectId },
  include: {
    user: true,
    datasets: true,
    schemas: true,
    generationJobs: true,
  },
});
```

## Connection Pooling

For production environments, consider using:

1. **Prisma Accelerate** - Managed connection pooling
2. **PgBouncer** - Self-hosted connection pooler
3. **Supabase Pooler** - If using Supabase

Configure in `.env`:

```env
# Direct connection for migrations
DATABASE_URL="postgresql://..."

# Pooled connection for queries
DATABASE_URL_POOLING="postgresql://..."
```

Update `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DATABASE_URL")
}
```

## Best Practices

1. **Always use the singleton client** from `lib/db/prisma.ts`
2. **Close connections** in serverless functions (Next.js API routes handle this automatically)
3. **Use transactions** for multi-step operations (MongoDB supports transactions in replica sets)
4. **Index frequently queried fields** (already configured in schema)
5. **Validate data** before database operations (use Zod schemas)
6. **Use MongoDB ObjectIds** for references between documents
7. **Leverage JSON fields** for flexible, nested data structures

## Prisma Studio

Visual database browser:

```bash
npm run db:studio
```

Opens at `http://localhost:5555`

## Database Operations

### Create a new schema push

```bash
npx prisma db push
```

### Reset database (⚠️ DESTRUCTIVE)

```bash
# Note: MongoDB doesn't use migrations, this recreates the database
npx prisma db push --force-reset
```

## Troubleshooting

### Client out of sync

```bash
npm run db:generate
```

### Connection issues

1. Check `.env` DATABASE_URL
2. Verify PostgreSQL is running
3. Check firewall/network settings
4. Test connection: `npm run db:studio`

### Connection issues

1. Check `.env` DATABASE_URL
2. Verify MongoDB is running: `docker ps` or check service status
3. Test connection: `npm run db:studio`
4. For MongoDB Atlas: Check IP whitelist and credentials

### Schema sync issues

```bash
npm run db:generate
npx prisma db push
```

### Migration conflicts (N/A for MongoDB)

MongoDB doesn't use migrations. Use `prisma db push` to sync schema changes.

---

## 🔄 MongoDB vs PostgreSQL

| Feature | MongoDB | PostgreSQL (Previous) |
|---------|---------|----------------------|
| **Schema** | Flexible, schema-less | Fixed schema with migrations |
| **Primary Keys** | ObjectId (auto-generated) | CUID or UUID |
| **Relations** | Via Prisma (no native joins) | Native foreign keys |
| **JSON Fields** | Native support | Supported via JSONB |
| **Transactions** | Replica sets required | Native support |
| **Migrations** | Not needed (`db push`) | Required (`migrate`) |
| **Indexes** | Supported | Supported |

## Resources

- [Prisma with MongoDB Documentation](https://www.prisma.io/docs/concepts/database-connectors/mongodb)
- [MongoDB Documentation](https://www.mongodb.com/docs/)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)
