import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LayoutTemplate } from "lucide-react";
import { getCurrentUserId } from "@/lib/auth/session";
import { listTemplatesForUser } from "@/lib/db/services/visual-template-service";
import TemplateGallery from "@/components/modules/templates/template-gallery";

export const metadata = {
  title: "Templates | DataForge",
};

export default async function TemplatesPage() {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/login");
  }

  const { own, shared } = await listTemplatesForUser(userId);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        <div className="mb-8 flex items-start gap-3">
          <LayoutTemplate className="mt-1 size-7 text-slate-700 dark:text-slate-300" />
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
              Visual Templates
            </h1>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              Design invoice and bank-statement layouts, then render generated data
              into PDFs from a workspace&apos;s Documents tab.
            </p>
          </div>
        </div>

        <TemplateGallery initialTemplates={own} publicTemplates={shared} />
      </div>
    </div>
  );
}
