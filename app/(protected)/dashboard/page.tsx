import { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { signOutUser } from "@/lib/auth/actions";
import { getUserStats, getWorkspacesByUserId } from "@/lib/db/queries";
import CreateWorkspaceDialog from "@/components/modules/workspace/create-workspace-dialog";
import WorkspaceList from "@/components/modules/workspace/workspace-list";
import { LogOut, LayoutDashboard, FolderOpen, Cpu, CheckCircle, Settings, LayoutTemplate } from "lucide-react";

export const metadata: Metadata = {
  title: "Dashboard | DataForge",
  description: "Your DataForge workspaces and generation jobs",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const [stats, workspaceResult] = user?.id
    ? await Promise.all([
        getUserStats(user.id).catch(() => null),
        getWorkspacesByUserId(user.id, {
          limit: 100,
          sortBy: "createdAt",
          sortOrder: "desc",
        }).catch(() => null),
      ])
    : [null, null];
  const workspaces = workspaceResult?.data ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
              DataForge
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/templates"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <LayoutTemplate className="w-4 h-4" />
              Templates
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Settings className="w-4 h-4" />
              Settings
            </Link>
            <form action={signOutUser}>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </form>
          </div>
        </div>

        {/* Welcome */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-8 mb-8">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-1">
            Welcome back, {user?.name || "User"}!
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
            Manage your workspaces, schemas, and data generation jobs from here.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-md">
              <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Email</p>
              <p className="font-medium text-slate-900 dark:text-slate-50 truncate">
                {user?.email}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-md">
              <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Role</p>
              <p className="font-medium text-slate-900 dark:text-slate-50">
                {user?.role}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-md">
              <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">User ID</p>
              <p className="font-mono text-xs font-medium text-slate-900 dark:text-slate-50 truncate">
                {user?.id}
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex items-center gap-4">
              <FolderOpen className="w-8 h-8 text-blue-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                  {stats.workspaceCount}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {stats.workspaceCount === 1 ? "Workspace" : "Workspaces"}
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex items-center gap-4">
              <Cpu className="w-8 h-8 text-violet-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                  {stats.totalJobs}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Generation {stats.totalJobs === 1 ? "Job" : "Jobs"}
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex items-center gap-4">
              <CheckCircle className="w-8 h-8 text-emerald-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                  {stats.successRate.toFixed(0)}%
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Success Rate</p>
              </div>
            </div>
          </div>
        )}

        {/* Workspaces section */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Workspaces
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Workspaces organise your schema definitions and generation jobs.
              </p>
            </div>
            <CreateWorkspaceDialog />
          </div>
          {workspaceResult === null && user?.id ? (
            <p className="text-sm text-[var(--color-destructive)]">
              Failed to load workspaces. Please refresh the page.
            </p>
          ) : (
            <WorkspaceList workspaces={workspaces} />
          )}
        </div>

      </div>
    </div>
  );
}
