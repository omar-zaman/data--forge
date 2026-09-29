# Authentication Setup Guide

Follow these steps to get authentication running in your DataForge application.

---

## 📋 Prerequisites

- MongoDB database running (local or Atlas)
- Node.js 20+ installed
- npm dependencies installed

---

## 🚀 Quick Start

### 1. Set Up Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
# Copy the example file
cp .env.example .env
```

Edit `.env` and set the following required variables:

```bash
# Database (MongoDB)
DATABASE_URL="mongodb://localhost:27017/dataforge"

# For MongoDB Atlas (Cloud):
# DATABASE_URL="mongodb+srv://username:password@cluster.mongodb.net/dataforge?retryWrites=true&w=majority"

# NextAuth.js Configuration
NEXTAUTH_SECRET="your-super-secret-key-change-this-in-production"
NEXTAUTH_URL="http://localhost:3000"
```

**Generate a secure NEXTAUTH_SECRET:**

```bash
# On Linux/Mac
openssl rand -base64 32

# On Windows (PowerShell)
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

### 2. Update Database Schema

The schema has been updated to use MongoDB. Run:

```bash
# Generate Prisma Client with new schema
npm run db:generate

# Push schema changes to MongoDB (no migrations needed)
npm run db:push
```

### 3. (Optional) Configure OAuth Providers

#### GitHub OAuth

1. Go to: https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: DataForge Local
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`
4. Copy Client ID and Client Secret to `.env`:

```bash
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
```

#### Google OAuth

1. Go to: https://console.cloud.google.com/apis/credentials
2. Create a new project or select existing
3. Click "Create Credentials" → "OAuth Client ID"
4. Configure OAuth consent screen if prompted
5. Select "Web application"
6. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
7. Copy Client ID and Client Secret to `.env`:

```bash
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

### 4. Start the Development Server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

---

## 🧪 Test Authentication

### Test Email/Password Authentication

1. Navigate to http://localhost:3000/register
2. Fill in:
   - Name: John Doe
   - Email: john@example.com
   - Password: password123
3. Click "Create Account"
4. You should be redirected to `/dashboard`
5. Sign out and try logging in again at `/login`

### Test OAuth Authentication

1. Navigate to http://localhost:3000/login
2. Click either "GitHub" or "Google" button
3. Complete OAuth flow in popup
4. You should be redirected to `/dashboard`

### Test Route Protection

1. Try accessing http://localhost:3000/dashboard without signing in
   - Should redirect to `/login` with callback URL
2. Sign in and verify redirect back to `/dashboard`
3. Sign out and verify redirect to home page

---

## 📝 Create Your First User (Database Seed)

You can also create users directly via the database seed:

```bash
npm run db:seed
```

This creates three demo users:
- **Admin**: admin@dataforge.dev (role: ADMIN)
- **Developer**: developer@dataforge.dev (role: DEVELOPER)
- **User**: user@dataforge.dev (role: USER)

All demo users have no password (OAuth only). To set passwords, use the `updatePassword` action in your code.

---

## 🔧 Troubleshooting

### Issue: "NEXTAUTH_SECRET" is not set

**Solution**: Make sure you've created a `.env` file and set `NEXTAUTH_SECRET` with a secure random string (see step 1).

### Issue: OAuth providers not working

**Solution**:
1. Verify OAuth credentials in `.env` are correct
2. Check redirect URLs match exactly (including http vs https)
3. Ensure OAuth app is not restricted to specific domains
4. Clear browser cookies and try again

### Issue: Database connection error

**Solution**:
1. Verify MongoDB is running: `docker ps` or check service status
2. For local: Ensure MongoDB is started on port 27017
3. For Atlas: Check connection string, username, password, and IP whitelist
4. Verify `DATABASE_URL` in `.env` is correct
5. Test connection: `npm run db:studio`

### Issue: "Prisma Client is not generated"

**Solution**: Run `npm run db:generate` to generate the Prisma Client

### Issue: Session not persisting

**Solution**:
1. Check browser console for cookie errors
2. Verify `NEXTAUTH_URL` matches your local URL
3. Clear all cookies for localhost:3000
4. Restart dev server

---

## 🔒 Security Best Practices

### Production Deployment

When deploying to production:

1. **Generate new NEXTAUTH_SECRET**:
   ```bash
   openssl rand -base64 32
   ```

2. **Update NEXTAUTH_URL** to your production domain:
   ```bash
   NEXTAUTH_URL="https://yourdomain.com"
   ```

3. **Use HTTPS**: Never use HTTP in production

4. **Update OAuth redirect URLs** to production domain

5. **Enable secure cookies** (handled automatically by NextAuth when NEXTAUTH_URL is https)

6. **Use MongoDB connection with authentication**:
   ```bash
   # Local MongoDB with auth
   DATABASE_URL="mongodb://username:password@localhost:27017/dataforge?authSource=admin"
   
   # MongoDB Atlas
   DATABASE_URL="mongodb+srv://username:password@cluster.mongodb.net/dataforge?retryWrites=true&w=majority"
   ```

---

## 📊 Verify Installation

Run this checklist to verify everything is working:

- [ ] Environment variables are set
- [ ] Database schema is updated (`npm run db:generate && npm run db:push`)
- [ ] Dev server starts without errors (`npm run dev`)
- [ ] Home page loads at http://localhost:3000
- [ ] Can access /register page
- [ ] Can create account with email/password
- [ ] Redirected to /dashboard after registration
- [ ] Can sign out successfully
- [ ] Can sign in with existing credentials
- [ ] OAuth buttons visible (even if not configured)
- [ ] Protected routes redirect to /login when not authenticated
- [ ] TypeScript compilation passes (`npx tsc --noEmit`)

---

## 📚 Next Steps

Now that authentication is set up:

1. **Customize the UI**: Modify login/register pages in `app/(auth)/`
2. **Add role-based features**: Use `hasRole()` and `requireRole()` helpers
3. **Implement password reset**: Extend `requestPasswordReset()` action
4. **Add user profile page**: Create in `app/(protected)/settings/`
5. **Build your features**: Start Phase 2 - Core Application Features

---

## 🆘 Need Help?

- Check the [Phase 1.3 Complete](./.kiro/phase-1-3-authentication-complete.md) document
- Review [NextAuth.js documentation](https://authjs.dev)
- Check [Prisma documentation](https://www.prisma.io/docs)
- Inspect browser console and server logs for detailed errors

---

**Setup Guide Version**: 1.0  
**Last Updated**: September 29, 2026
