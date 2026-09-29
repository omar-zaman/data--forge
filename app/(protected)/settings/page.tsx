import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, KeyRound, Settings } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/forms/change-password-form";

export const metadata: Metadata = {
  title: "Settings | DataForge",
  description: "Manage your DataForge account",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?callbackUrl=/settings");
  }

  // Only a boolean crosses to the client — never the hash itself
  const hasPassword = !!user.password;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8">

        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Settings className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
              Settings
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {user.email}
            </p>
          </div>
        </div>

        {/* Password */}
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              Change password
            </CardTitle>
            <CardDescription>
              {hasPassword
                ? "Enter your current password, then choose a new one."
                : "Your account signs in with Google or GitHub, so there is no password to change."}
            </CardDescription>
          </CardHeader>
          {hasPassword && (
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          )}
        </Card>

      </div>
    </div>
  );
}
