import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";

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

  return (
    <>
      <ThemeToggle className="fixed top-3 right-3 z-40" />
      {children}
    </>
  );
}
