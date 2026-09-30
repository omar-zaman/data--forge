import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import AssistantProvider from "@/components/modules/assistant/assistant-provider";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Protected Layout
 * Ensures user is authenticated before accessing protected routes
 * and mounts the global AI assistant drawer and theme toggle header.
 */

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AssistantProvider>
      {/* Matches the top stop of the pages' slate gradient so the bar blends in */}
      <header className="flex h-12 items-center justify-end bg-slate-50 px-4 dark:bg-slate-950">
        <ThemeToggle />
      </header>
      {children}
    </AssistantProvider>
  );
}
