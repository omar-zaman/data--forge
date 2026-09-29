import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Protected Layout
 * Ensures user is authenticated before accessing protected routes
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

  return <>{children}</>;
}
