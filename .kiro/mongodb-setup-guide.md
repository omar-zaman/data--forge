# MongoDB Setup Guide for DataForge

Quick guide to get MongoDB running for your DataForge application.

---

## 🚀 Quick Start Options

### Option 1: Docker (Recommended for Development)

**Fastest way to get started:**

```bash
# Start MongoDB container
docker run --name dataforge-mongodb \
  -p 27017:27017 \
  -d mongo:7

# Verify it's running
docker ps

# View logs (optional)
docker logs dataforge-mongodb
```

**Stop/Start container:**
```bash
docker stop dataforge-mongodb
docker start dataforge-mongodb
```

**Remove container:**
```bash
docker stop dataforge-mongodb
docker rm dataforge-mongodb
```

### Option 2: MongoDB Atlas (Cloud - Free Tier)

**Best for production and team collaboration:**

1. Go to https://www.mongodb.com/cloud/atlas/register
2. Create a free account
3. Click "Build a Database"
4. Select "M0 Free" tier
5. Choose your cloud provider and region
6. Click "Create Cluster" (takes 3-5 minutes)

**Get Connection String:**
1. Click "Connect" on your cluster
2. Choose "Connect your application"
3. Copy the connection string
4. Replace `<password>` with your database user password
5. Replace `<dbname>` with `dataforge`

**Example connection string:**
```bash
DATABASE_URL="mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/dataforge?retryWrites=true&w=majority"
```

**Security Setup:**
1. Go to "Network Access" → "Add IP Address"
2. Click "Allow Access from Anywhere" (for development)
3. Or add your specific IP address

### Option 3: Local Installation

#### Windows
1. Download from https://www.mongodb.com/try/download/community
2. Run the installer
3. Install MongoDB as a Windows Service
4. MongoDB will start automatically

**Connection string:**
```bash
DATABASE_URL="mongodb://localhost:27017/dataforge"
```

#### macOS
```bash
# Install via Homebrew
brew tap mongodb/brew
brew install mongodb-community

# Start MongoDB
brew services start mongodb-community

# Stop MongoDB
brew services stop mongodb-community
```

**Connection string:**
```bash
DATABASE_URL="mongodb://localhost:27017/dataforge"
```

#### Linux (Ubuntu/Debian)
```bash
# Import MongoDB GPG key
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Install MongoDB
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Check status
sudo systemctl status mongod
```

**Connection string:**
```bash
DATABASE_URL="mongodb://localhost:27017/dataforge"
```

---

## 🔧 Configuration

### 1. Update Environment Variables

Create or update `.env` file:

```bash
# For local MongoDB (Docker or installed)
DATABASE_URL="mongodb://localhost:27017/dataforge"

# For MongoDB Atlas (Cloud)
DATABASE_URL="mongodb+srv://username:password@cluster.mongodb.net/dataforge?retryWrites=true&w=majority"

# NextAuth (already configured)
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"
```

### 2. Generate Prisma Client

```bash
npm run db:generate
```

### 3. Push Schema to MongoDB

```bash
npm run db:push
```

### 4. (Optional) Seed Demo Data

```bash
npm run db:seed
```

---

## ✅ Verify MongoDB Connection

### Using Prisma Studio
```bash
npm run db:studio
```

Opens at http://localhost:5555 - if you see your collections, it's working!

### Using MongoDB Compass (GUI)

1. Download from https://www.mongodb.com/try/download/compass
2. Connect using your connection string
3. Browse databases and collections

### Using mongosh (CLI)

```bash
# Install mongosh
npm install -g mongosh

# Connect to local MongoDB
mongosh

# List databases
show dbs

# Use dataforge database
use dataforge

# List collections
show collections

# Find users
db.users.find()
```

---

## 🐛 Troubleshooting

### Issue: "MongoServerError: Authentication failed"

**Solution:**
- Verify username and password in connection string
- For Atlas: Check database user credentials in Atlas UI
- Ensure URL encoding for special characters in password

### Issue: "connect ECONNREFUSED localhost:27017"

**Solution:**
- Check if MongoDB is running: `docker ps` or `sudo systemctl status mongod`
- Start MongoDB: `docker start dataforge-mongodb`
- Verify port 27017 is not blocked by firewall

### Issue: "MongooseServerSelectionError"

**Solution for Atlas:**
- Check IP whitelist in Atlas Network Access
- Verify cluster is active (not paused)
- Check internet connection
- Try connection string with `?retryWrites=true&w=majority`

### Issue: "Prisma Client could not connect"

**Solution:**
```bash
# Regenerate Prisma Client
npm run db:generate

# Force push schema
npx prisma db push --force-reset
```

---

## 📊 MongoDB Tools

### MongoDB Compass (Recommended)
- **GUI for MongoDB**
- Download: https://www.mongodb.com/try/download/compass
- Features: Browse data, create indexes, run queries

### Prisma Studio
- **Built-in database browser**
- Run: `npm run db:studio`
- Web-based, integrated with your schema

### mongosh
- **MongoDB Shell (CLI)**
- Install: `npm install -g mongosh`
- Direct database access via terminal

---

## 🔐 Security Best Practices

### Development
- Use Docker or local MongoDB
- No authentication needed for localhost
- Keep DATABASE_URL in `.env` (not committed)

### Production
- **Always use authentication**
- **Use MongoDB Atlas or managed hosting**
- **Enable IP whitelisting**
- **Use strong passwords**
- **Enable encryption at rest**
- **Use TLS/SSL connections**

**Secure connection string:**
```bash
DATABASE_URL="mongodb://username:strongpassword@host:27017/dataforge?authSource=admin&tls=true"
```

---

## 📦 MongoDB vs Development Server

| Setup | Use Case | Pros | Cons |
|-------|----------|------|------|
| **Docker** | Local development | Fast setup, isolated, reproducible | Requires Docker |
| **Atlas Free** | Development + Staging | Managed, free tier, cloud backup | Internet required |
| **Atlas Paid** | Production | High availability, scalability | Cost |
| **Local Install** | Offline development | No Docker needed, fast | Manual setup |

---

## 🎯 Recommended Setup

**For Solo Development:**
- Use Docker for local MongoDB
- Simple, fast, reproducible

**For Team Development:**
- Use MongoDB Atlas (Free tier)
- Shared database, no local setup needed

**For Production:**
- Use MongoDB Atlas (Paid tier)
- Or managed MongoDB on AWS/Azure/GCP
- Enable monitoring, backups, replication

---

## 🔄 Switching Between Setups

You can easily switch between local and Atlas:

```bash
# Local development
DATABASE_URL="mongodb://localhost:27017/dataforge"

# Staging (Atlas)
DATABASE_URL="mongodb+srv://user:pass@staging-cluster.mongodb.net/dataforge"

# Production (Atlas)
DATABASE_URL="mongodb+srv://user:pass@prod-cluster.mongodb.net/dataforge"
```

Just update `.env` and restart your dev server!

---

## 📚 Resources

- [MongoDB Installation Guide](https://www.mongodb.com/docs/manual/installation/)
- [MongoDB Atlas Documentation](https://www.mongodb.com/docs/atlas/)
- [MongoDB Docker Hub](https://hub.docker.com/_/mongo)
- [Prisma MongoDB Guide](https://www.prisma.io/docs/concepts/database-connectors/mongodb)

---

**Quick Command Reference:**

```bash
# Docker
docker run --name dataforge-mongodb -p 27017:27017 -d mongo:7

# Setup
npm run db:generate
npm run db:push
npm run db:seed

# Verify
npm run db:studio

# Development
npm run dev
```

---

**Status**: Ready for MongoDB! 🎉
