import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so a stray lockfile in a parent folder isn't picked up
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Node-only queue/zip/PDF libraries are loaded with native require instead of bundled
  serverExternalPackages: ["bullmq", "ioredis", "archiver", "@react-pdf/renderer"],
};

export default nextConfig;
