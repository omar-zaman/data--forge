import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * Auth Layout
 * Redirects authenticated users to dashboard
 */

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
