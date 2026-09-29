import { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/forms/login-form";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Login | DataForge",
  description: "Sign in to your DataForge account",
};

export default function LoginPage() {
  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your account to continue
          </p>
        </div>

        <Suspense fallback={<div>Loading...</div>}>
          <LoginForm />
        </Suspense>

        <p className="px-8 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="hover:text-primary underline underline-offset-4"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
