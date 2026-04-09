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

// Trim all values — copy-paste from dashboards often introduces trailing
// whitespace or newlines, which silently break URLs and auth headers.
const DATABASE_URL = process.env.DATABASE_URL.trim();
const BACKUP_PASSPHRASE = process.env.BACKUP_PASSPHRASE.trim();
let R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID.trim();
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID.trim();
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY.trim();
const R2_BUCKET = process.env.R2_BUCKET.trim();

// Guard: if the user pasted the full endpoint URL as the account ID, extract
// just the account ID portion.
if (R2_ACCOUNT_ID.includes(".r2.cloudflarestorage.com")) {
  const match = R2_ACCOUNT_ID.match(/(?:https?:\/\/)?([a-f0-9]+)\.r2\.cloudflarestorage\.com/i);
  if (match) {
    console.log("→ backup-prod: R2_ACCOUNT_ID contained a full URL, extracting account ID");
    R2_ACCOUNT_ID = match[1];
  }
}
console.log(`→ backup-prod: R2_ACCOUNT_ID length=${R2_ACCOUNT_ID.length} chars=${R2_ACCOUNT_ID.slice(0, 6)}...`);

// ─── Build object key ───────────────────────────────────────────────────────

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

const objectKey = `daily/prod-${timestamp()}.sql.gz.gpg`;

// ─── Validate DATABASE_URL ───────────────────────────────────────────────────

// Log the sanitized URL (scheme + host + port, no password) for debugging.
try {
  const parsed = new URL(DATABASE_URL);
  console.log(`→ backup-prod: DB host=${parsed.hostname} port=${parsed.port} db=${parsed.pathname.slice(1)} scheme=${parsed.protocol}`);
  if (parsed.hostname.includes("railway.internal")) {
    console.error("✗ backup-prod: PROD_DATABASE_URL uses Railway's internal hostname.");
    console.error("  GitHub Actions runs outside Railway's private network. Use the PUBLIC url");
    console.error("  (the one with .proxy.rlwy.net in it).");
    process.exit(2);
  }
} catch {
  console.error(`✗ backup-prod: DATABASE_URL is not a valid URL (length=${DATABASE_URL.length}).`);
  console.error("  It should start with postgresql:// or postgres://");
  console.error("  First 30 chars (redacted): " + DATABASE_URL.slice(0, 30).replace(/:[^:@]+@/, ":***@"));
  process.exit(2);
}

// ─── Pipeline: pg_dump | gzip | gpg → buffer → R2 ──────────────────────────
//
// pg_dump dumps the DB, piped through gzip and gpg for compression + encryption.
// We buffer the encrypted output into memory before uploading to R2, because
// Cloudflare R2's S3-compatible API does not support streaming uploads without
// a known content-length. For a typical Discord bot DB (<50 MB compressed),
// this is fine.

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

// ─── Buffer the encrypted output ────────────────────────────────────────────

const chunks = [];
gpg.stdout.on("data", (chunk) => chunks.push(chunk));

const [pgDumpExit, gzipExit, gpgExit] = await Promise.all([
  new Promise((resolve) => pgDump.on("exit", resolve)),
  new Promise((resolve) => gzip.on("exit", resolve)),
  new Promise((resolve) => gpg.on("exit", resolve)),
]);

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

const encrypted = Buffer.concat(chunks);
console.log(`→ backup-prod: dump complete, encrypted size = ${(encrypted.length / 1024).toFixed(1)} KB`);

if (encrypted.length === 0) {
  console.error("✗ backup-prod: encrypted output is empty — pg_dump likely produced no data.");
  process.exit(1);
}

// ─── Upload buffer to R2 ────────────────────────────────────────────────────

const r2Endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
console.log(`→ backup-prod: uploading to ${r2Endpoint} bucket=${R2_BUCKET}`);

// TLS connectivity test — bypass the SDK to isolate the issue
try {
  const testResp = await fetch(r2Endpoint, { method: "HEAD" });
  console.log(`→ backup-prod: R2 TLS connectivity OK (HTTP ${testResp.status})`);
} catch (tlsErr) {
  console.error(`✗ backup-prod: R2 TLS connectivity test failed: ${tlsErr.message}`);
  console.error("  This means the GitHub Actions runner cannot establish a TLS connection");
  console.error("  to the R2 endpoint. Check that R2_ACCOUNT_ID is a 32-char hex string.");
  console.error(`  Endpoint tested: ${r2Endpoint}`);
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: r2Endpoint,
  forcePathStyle: true, // R2 uses path-style, not virtual-hosted-style
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
      Body: encrypted,
      ContentType: "application/octet-stream",
      ContentLength: encrypted.length,
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

console.log(`✓ backup-prod: uploaded ${objectKey} to bucket "${R2_BUCKET}"`);
