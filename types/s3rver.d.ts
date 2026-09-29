// Minimal typings for s3rver (local S3-compatible dev server, scripts/dev-services.ts)
declare module "s3rver" {
  interface S3rverOptions {
    address?: string;
    port?: number;
    directory?: string;
    silent?: boolean;
    resetOnClose?: boolean;
    configureBuckets?: { name: string; configs: (string | Buffer)[] }[];
  }

  export default class S3rver {
    constructor(options?: S3rverOptions);
    run(): Promise<{ address: string; port: number }>;
    close(): Promise<void>;
  }
}
