import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only queue/zip/PDF libraries are loaded with native require instead of bundled
  serverExternalPackages: ["bullmq", "ioredis", "archiver", "@react-pdf/renderer"],
};

export default nextConfig;
