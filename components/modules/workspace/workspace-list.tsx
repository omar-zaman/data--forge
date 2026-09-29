import Link from "next/link";
import { ArrowRight, CalendarDays, FolderOpen } from "lucide-react";
import type { Workspace } from "@/types/database";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

interface WorkspaceListProps {
  workspaces: Workspace[];
}

export default function WorkspaceList({ workspaces }: WorkspaceListProps) {
  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-12 text-center">
        <FolderOpen className="w-8 h-8 text-slate-400" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No workspaces found. Create your first one!
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {workspaces.map((ws) => (
        <li key={ws.id}>
          <Link
            href={`/workspace/${ws.id}`}
            className="group flex h-full flex-col gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-5 transition-colors hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-semibold text-slate-900 dark:text-slate-50 line-clamp-1">
                {ws.name}
              </h4>
              <ArrowRight className="w-4 h-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]" />
            </div>
            <p className="flex-1 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">
              {ws.description || (
                <span className="italic">No description</span>
              )}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <CalendarDays className="w-3.5 h-3.5" />
              Created {dateFormatter.format(new Date(ws.createdAt))}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
