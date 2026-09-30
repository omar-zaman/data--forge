import { Rocket, Zap, Database, Code2 } from "lucide-react";
import Link from "next/link";
import { auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function HomePage() {
  const session = await auth();

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <header className="flex h-12 items-center justify-end px-4">
        <ThemeToggle />
      </header>
      <div className="container mx-auto px-4 pb-16 pt-4">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-6">
            <Rocket className="w-12 h-12 text-blue-600 dark:text-blue-400" />
            <h1 className="text-5xl font-bold text-slate-900 dark:text-slate-50">
              DataForge
            </h1>
          </div>
          <p className="text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-8">
            Full-Stack Application Generator with AI-Powered Tools
          </p>

          {/* Auth Buttons */}
          <div className="flex items-center justify-center gap-4">
            {session?.user ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <FeatureCard
            icon={<Zap className="w-8 h-8" />}
            title="Next.js App Router"
            description="Built with Next.js 16, TypeScript, and modern React patterns"
          />
          <FeatureCard
            icon={<Database className="w-8 h-8" />}
            title="Type-Safe"
            description="Full TypeScript support with Zod validation schemas"
          />
          <FeatureCard
            icon={<Code2 className="w-8 h-8" />}
            title="Shadcn UI"
            description="Beautiful components built with Radix UI and Tailwind CSS"
          />
        </div>

        {/* Status Badge */}
        <div className="mt-16 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
            System Ready
          </span>
        </div>
      </div>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow">
      <div className="text-blue-600 dark:text-blue-400 mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-2">
        {title}
      </h3>
      <p className="text-slate-600 dark:text-slate-400 text-sm">{description}</p>
    </div>
  );
}
