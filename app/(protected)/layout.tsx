import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import AssistantProvider from "@/components/modules/assistant/assistant-provider";

/**
 * Protected Layout
 * Ensures user is authenticated before accessing protected routes
 * and mounts the global AI assistant drawer.
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

  return <AssistantProvider>{children}</AssistantProvider>;
}
