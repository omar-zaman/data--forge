/**
 * Loads .env / .env.local the same way `next dev` does. Imported first by the
 * standalone worker, which runs outside Next.js.
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
