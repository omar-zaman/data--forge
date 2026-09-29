import { auth } from "@/auth";

/**
 * Next.js 16 Proxy (formerly middleware.ts) — route protection
 * Unauthenticated requests to protected routes are redirected to /login.
 */

const PROTECTED_ROUTE = /^\/(dashboard|workspace|projects|settings)(\/|$)/;
const AUTH_ROUTE = /^\/(login|register)(\/|$)/;

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth?.user;

  // Redirect authenticated users from auth pages to dashboard
  if (isLoggedIn && AUTH_ROUTE.test(nextUrl.pathname)) {
    return Response.redirect(new URL("/dashboard", nextUrl));
  }

  // Redirect unauthenticated users from protected routes to login
  if (!isLoggedIn && PROTECTED_ROUTE.test(nextUrl.pathname)) {
    const callbackUrl = encodeURIComponent(nextUrl.pathname + nextUrl.search);
    return Response.redirect(
      new URL(`/login?callbackUrl=${callbackUrl}`, nextUrl)
    );
  }

  return;
});

/**
 * Only run the proxy on protected and auth routes.
 * `:path*` covers the route itself and every sub-route (e.g. /workspace/abc/settings).
 */
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/workspace/:path*",
    "/projects/:path*",
    "/settings/:path*",
    "/login/:path*",
    "/register/:path*",
  ],
};
