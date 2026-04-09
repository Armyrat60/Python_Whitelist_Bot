#!/usr/bin/env node
/**
 * backup-prod.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Streams a full pg_dump of the production database, compresses it, encrypts
 * it with GPG (AES-256 symmetric, passphrase from env), and uploads it to a
 * Cloudflare R2 bucket via the S3-compatible API.
 *
 * Designed to run from GitHub Actions on a daily cron, but also runnable
 * locally before any risky migration:
 *
 *   DATABASE_URL=...      \
 *   BACKUP_PASSPHRASE=... \
 *   R2_ACCOUNT_ID=...     \
 *   R2_ACCESS_KEY_ID=...  \
 *   R2_SECRET_ACCESS_KEY=... \
 *   R2_BUCKET=squadwhitelister-db-backups \
 *   node api/scripts/backup-prod.mjs
 *
 * Output object keys:
 *   daily/prod-YYYY-MM-DD-HHMM.sql.gz.gpg
 *
 * Retention is enforced by `prune-backups.mjs`, run from the same workflow.
 *
 * Requirements:
 *   - pg_dump on PATH (postgresql-client package, or PostgreSQL install)
 *   - gpg on PATH (gnupg package; pre-installed on GitHub Actions ubuntu-latest)
 *   - @aws-sdk/client-s3 in api/node_modules
 */

import { spawn } from "node:child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

// ─── Required env ───────────────────────────────────────────────────────────

const REQUIRED = [
  "DATABASE_URL",
  "BACKUP_PASSPHRASE",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`✗ backup-prod: missing required env vars: ${missing.join(", ")}`);
  process.exit(2);
}

const {
  DATABASE_URL,
  BACKUP_PASSPHRASE,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
} = process.env;

// ─── Build object key ───────────────────────────────────────────────────────

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

const objectKey = `daily/prod-${timestamp()}.sql.gz.gpg`;

// ─── Pipeline: pg_dump | gzip | gpg ─────────────────────────────────────────
//
// We pipe the encrypted output of gpg directly into the R2 PutObject body.
// The S3 SDK accepts a Node Readable stream as Body for PutObjectCommand,
// which lets us avoid buffering the whole dump in memory or on disk.

console.log(`→ backup-prod: starting pg_dump → gzip → gpg → R2 (${objectKey})`);

const pgDump = spawn(
  "pg_dump",
  [
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
    "--quote-all-identifiers",
    "--format=plain",
    "--dbname",
    DATABASE_URL,
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);

const gzip = spawn("gzip", ["-9"], {
  stdio: [pgDump.stdout, "pipe", "inherit"],
});

const gpg = spawn(
  "gpg",
  [
    "--batch",
    "--yes",
    "--quiet",
    "--no-tty",
    "--symmetric",
    "--cipher-algo",
    "AES256",
    "--passphrase-fd",
    "3",
  ],
  {
    stdio: [gzip.stdout, "pipe", "inherit", "pipe"],
  },
);

// Write the passphrase to fd 3 so it never appears on the command line.
gpg.stdio[3].write(BACKUP_PASSPHRASE + "\n");
gpg.stdio[3].end();

// Track child failures
let pgDumpExit, gzipExit, gpgExit;
pgDump.on("exit", (code) => (pgDumpExit = code));
gzip.on("exit", (code) => (gzipExit = code));
gpg.on("exit", (code) => (gpgExit = code));

// ─── Upload encrypted stream to R2 ──────────────────────────────────────────

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

try {
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey,
      Body: gpg.stdout,
      ContentType: "application/octet-stream",
      Metadata: {
        "backup-source": "github-actions",
        "backup-timestamp-utc": new Date().toISOString(),
      },
    }),
  );
} catch (err) {
  console.error(`✗ backup-prod: R2 upload failed: ${err.message}`);
  process.exit(1);
}

// Wait for all three child processes to flush
await new Promise((resolve) => {
  const tick = () => {
    if (pgDumpExit !== undefined && gzipExit !== undefined && gpgExit !== undefined) {
      resolve();
    } else {
      setTimeout(tick, 50);
    }
  };
  tick();
});

if (pgDumpExit !== 0) {
  console.error(`✗ backup-prod: pg_dump exited with code ${pgDumpExit}`);
  process.exit(1);
}
if (gzipExit !== 0) {
  console.error(`✗ backup-prod: gzip exited with code ${gzipExit}`);
  process.exit(1);
}
if (gpgExit !== 0) {
  console.error(`✗ backup-prod: gpg exited with code ${gpgExit}`);
  process.exit(1);
}

console.log(`✓ backup-prod: uploaded ${objectKey} to bucket "${R2_BUCKET}"`);
