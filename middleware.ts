import { auth } from "@/auth";

/**
 * Next.js Middleware for Route Protection
 * Runs on Edge runtime for optimal performance
 */

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Define route patterns
  const isPublicRoute = 
    nextUrl.pathname === "/" ||
    nextUrl.pathname.startsWith("/api/auth") ||
    nextUrl.pathname.startsWith("/login") ||
    nextUrl.pathname.startsWith("/register");

  const isProtectedRoute =
    nextUrl.pathname.startsWith("/dashboard") ||
    nextUrl.pathname.startsWith("/projects") ||
    nextUrl.pathname.startsWith("/settings");

  // Redirect authenticated users from auth pages to dashboard
  if (isLoggedIn && (nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/register"))) {
    return Response.redirect(new URL("/dashboard", nextUrl));
  }

  // Redirect unauthenticated users from protected routes to login
  if (!isLoggedIn && isProtectedRoute) {
    const callbackUrl = encodeURIComponent(nextUrl.pathname + nextUrl.search);
    return Response.redirect(new URL(`/login?callbackUrl=${callbackUrl}`, nextUrl));
  }

  // Allow all other requests
  return;
});

/**
 * Middleware configuration
 * Specifies which routes should run through the middleware
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes (except /api/auth)
     */
    "/((?!_next/static|_next/image|favicon.ico|public|api(?!/auth)).*)",
  ],
};
