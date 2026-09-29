/**
 * S3 / Cloudflare R2 object storage for job exports.
 *
 * Objects are uploaded without an ACL, so they inherit the bucket's private
 * default and are reachable only through short-lived presigned URLs.
 *
 * Key layout:  workspaces/<workspaceId>/jobs/<jobId>/<fileName>
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const PRESIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
/** Stored URLs expiring sooner than this are re-signed when read. */
const PRESIGNED_URL_REFRESH_MARGIN_SECONDS = 60 * 60;

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

// ============================================
// Client
// ============================================

interface StorageConfig {
  client: S3Client;
  bucket: string;
}

const globalForStorage = globalThis as typeof globalThis & {
  dataForgeStorage?: StorageConfig;
};

function getStorage(): StorageConfig {
  if (globalForStorage.dataForgeStorage) return globalForStorage.dataForgeStorage;

  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new StorageError("S3_BUCKET is not configured");
  }

  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  const client = new S3Client({
    // R2 expects "auto"; AWS needs the bucket's real region
    region: process.env.S3_REGION || "auto",
    ...(process.env.S3_ENDPOINT && { endpoint: process.env.S3_ENDPOINT }),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    // Fall back to the default AWS credential chain when keys aren't set
    ...(accessKeyId &&
      secretAccessKey && { credentials: { accessKeyId, secretAccessKey } }),
    // Only send checksums where the API requires them (keeps R2/MinIO compatible)
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  globalForStorage.dataForgeStorage = { client, bucket };
  return globalForStorage.dataForgeStorage;
}

// ============================================
// Keys
// ============================================

function assertObjectId(value: string, label: string): void {
  if (!OBJECT_ID_RE.test(value)) {
    throw new StorageError(`Invalid ${label} "${value}"`);
  }
}

export function workspaceExportPrefix(workspaceId: string): string {
  assertObjectId(workspaceId, "workspace id");
  return `workspaces/${workspaceId}/`;
}

export function jobExportPrefix(workspaceId: string, jobId: string): string {
  assertObjectId(jobId, "job id");
  return `${workspaceExportPrefix(workspaceId)}jobs/${jobId}/`;
}

/** Extracts the job id from a key laid out as workspaces/<ws>/jobs/<job>/... */
export function jobIdFromKey(key: string): string | null {
  const match = /^workspaces\/[a-f0-9]{24}\/jobs\/([a-f0-9]{24})\//i.exec(key);
  return match ? match[1] : null;
}

// ============================================
// Operations
// ============================================

/** Streams a local file into the bucket as a private object. Returns its size in bytes. */
export async function uploadFile(
  key: string,
  filePath: string,
  contentType: string,
  downloadName: string
): Promise<number> {
  const { client, bucket } = getStorage();
  const { size } = await stat(filePath);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
      ContentDisposition: `attachment; filename="${downloadName}"`,
    })
  );
  return size;
}

/** Uploads an in-memory artifact (e.g. a rendered PDF) as a private object. Returns its size in bytes. */
export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string,
  downloadName: string
): Promise<number> {
  const { client, bucket } = getStorage();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: body.byteLength,
      ContentType: contentType,
      ContentDisposition: `attachment; filename="${downloadName}"`,
    })
  );
  return body.byteLength;
}

export async function presignDownloadUrl(
  key: string,
  expiresIn = PRESIGNED_URL_TTL_SECONDS
): Promise<string> {
  const { client, bucket } = getStorage();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn,
  });
}

/** Seconds until a SigV4 presigned URL expires, or null if it isn't one. */
function presignedSecondsRemaining(url: URL): number | null {
  const date = url.searchParams.get("X-Amz-Date");
  const expires = Number(url.searchParams.get("X-Amz-Expires"));
  const m = date && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
  if (!m || !Number.isFinite(expires)) return null;

  const signedAt = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return (signedAt + expires * 1000 - Date.now()) / 1000;
}

/**
 * Returns a freshly signed URL when `url` is a presigned URL for an object under
 * `expectedPrefix` that has expired or is about to; otherwise null (keep as is).
 * The prefix check guarantees only the job's own objects are ever re-signed.
 */
export async function refreshPresignedUrl(
  url: string,
  expectedPrefix: string
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const remaining = presignedSecondsRemaining(parsed);
  if (remaining === null || remaining > PRESIGNED_URL_REFRESH_MARGIN_SECONDS) {
    return null;
  }

  // Works for both virtual-hosted (/key) and path-style (/bucket/key) URLs
  const path = parsed.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
  const start = path.indexOf(expectedPrefix);
  if (start === -1) return null;

  return presignDownloadUrl(path.slice(start));
}

export async function* listObjects(prefix: string): AsyncGenerator<_Object> {
  const { client, bucket } = getStorage();
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const object of page.Contents ?? []) yield object;
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

/** Deletes every object under `prefix`. Returns the number of objects removed. */
export async function deletePrefix(prefix: string): Promise<number> {
  if (!prefix.endsWith("/") || !prefix.startsWith("workspaces/")) {
    throw new StorageError(`Refusing to delete unscoped prefix "${prefix}"`);
  }
  const { client, bucket } = getStorage();

  let deleted = 0;
  let batch: string[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
    if (result.Errors?.length) {
      const first = result.Errors[0];
      throw new StorageError(
        `Failed to delete ${result.Errors.length} object(s) under "${prefix}": ${first.Key} (${first.Code})`
      );
    }
    deleted += batch.length;
    batch = [];
  };

  for await (const object of listObjects(prefix)) {
    if (object.Key) batch.push(object.Key);
    if (batch.length === 1000) await flush();
  }
  await flush();

  return deleted;
}
