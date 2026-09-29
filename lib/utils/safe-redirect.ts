const DEFAULT_REDIRECT = "/dashboard";
const PLACEHOLDER_ORIGIN = "http://localhost";

/**
 * Returns `target` only if it is a same-origin relative path, otherwise the
 * fallback. Rejects absolute URLs, protocol-relative URLs ("//evil.com"),
 * backslash tricks ("/\evil.com", which browsers normalize to "//") and
 * control characters, so a crafted ?callbackUrl= can't be used for phishing.
 */
export function getSafeRedirect(
  target: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT
): string {
  if (!target || !target.startsWith("/")) return fallback;
  if (target.startsWith("//") || target.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(target)) return fallback;

  try {
    const url = new URL(target, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
