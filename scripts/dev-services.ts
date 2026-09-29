/**
 * Local development services for the job pipeline:
 *   - Redis (BullMQ queue)     .services/redis/redis-server.exe  → REDIS_URL
 *   - S3-compatible storage    s3rver (Node, in-process)         → S3_ENDPOINT / S3_BUCKET
 *
 * Data is kept under .services/redis-data and .services/s3-data (gitignored).
 * Run with: npm run services   (keep it running next to `npm run dev` and `npm run worker`)
 */

import "../lib/queue/load-env";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import S3rver from "s3rver";

const root = process.cwd();
const servicesDir = path.join(root, ".services");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[services] ${name} is not set in .env.local`);
    process.exit(1);
  }
  return value;
}

// ---------------- Redis ----------------

function startRedis(): ChildProcess {
  const url = new URL(required("REDIS_URL"));
  const exe = path.join(servicesDir, "redis", "redis-server.exe");
  if (!existsSync(exe)) {
    console.error(`[services] Redis not found at ${exe}`);
    process.exit(1);
  }
  const dataDir = path.join(servicesDir, "redis-data");
  mkdirSync(dataDir, { recursive: true });

  // Relative --dir: the msys2 build resolves it against cwd, avoiding Windows path quirks
  const redis = spawn(
    exe,
    ["--port", url.port || "6379", "--bind", url.hostname, "--dir", ".", "--save", "60 1", "--appendonly", "no"],
    { cwd: dataDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  );
  const log = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) console.log(`[redis] ${line.replace(/^\d+:\w \d+ \w+ \d+ [\d:.]+ /, "")}`);
    }
  };
  redis.stdout?.on("data", log);
  redis.stderr?.on("data", log);
  redis.on("exit", (code) => {
    console.error(`[services] Redis exited (code ${code})`);
    void shutdown(1);
  });
  return redis;
}

// ---------------- S3 (s3rver) ----------------

async function startS3(): Promise<S3rver> {
  const endpoint = new URL(required("S3_ENDPOINT"));
  const bucket = required("S3_BUCKET");
  const directory = path.join(servicesDir, "s3-data");
  mkdirSync(directory, { recursive: true });

  const server = new S3rver({
    address: endpoint.hostname,
    port: Number(endpoint.port || 80),
    directory,
    silent: true,
    configureBuckets: [{ name: bucket, configs: [] }],
  });
  await server.run();
  console.log(`[s3] Listening on ${endpoint.origin}, bucket "${bucket}" ready (data: .services/s3-data)`);
  return server;
}

// ---------------- Lifecycle ----------------

let redis: ChildProcess | undefined;
let s3: S3rver | undefined;
let stopping = false;

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log("[services] Stopping...");
  redis?.removeAllListeners("exit");
  redis?.kill();
  await s3?.close().catch(() => undefined);
  process.exit(code);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

(async () => {
  redis = startRedis();
  s3 = await startS3();
  console.log(`[redis] Listening on ${process.env.REDIS_URL}`);
  console.log("[services] Ready. Press Ctrl+C to stop.");
})().catch((error) => {
  console.error("[services] Failed to start:", error);
  void shutdown(1);
});
