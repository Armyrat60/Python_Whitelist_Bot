#!/usr/bin/env node
/**
 * restore-prod.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Streams an encrypted backup from R2, decrypts it, decompresses it, and
 * pipes it into psql to restore. ALWAYS runs against an explicit
 * RESTORE_TARGET_URL (never DATABASE_URL) so you cannot accidentally clobber
 * production by typo.
 *
 * Usage:
 *   RESTORE_TARGET_URL=postgresql://localhost/restore_test \
 *   BACKUP_PASSPHRASE=...                                  \
 *   R2_ACCOUNT_ID=...                                      \
 *   R2_ACCESS_KEY_ID=...                                   \
 *   R2_SECRET_ACCESS_KEY=...                               \
 *   R2_BUCKET=squadwhitelister-db-backups                  \
 *   node api/scripts/restore-prod.mjs daily/prod-2026-04-06-0300.sql.gz.gpg
 *
 * To list available backups instead of restoring:
 *   node api/scripts/restore-prod.mjs --list
 *
 * Safety:
 *   - Refuses to run if RESTORE_TARGET_URL is unset.
 *   - Refuses to run if RESTORE_TARGET_URL appears to point at the same host
 *     as the production DB unless --i-know-what-im-doing is also passed.
 *   - Prints a 5-second countdown before piping into psql.
 */

import { spawn } from "node:child_process";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

// ─── Required env ───────────────────────────────────────────────────────────

const REQUIRED_BASE = [
  "BACKUP_PASSPHRASE",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];

const args = process.argv.slice(2);
const isList = args.includes("--list");
const safetyOverride = args.includes("--i-know-what-im-doing");
const objectKey = args.find((a) => !a.startsWith("--"));

const missing = REQUIRED_BASE.filter((k) => !process.env[k]);
if (!isList) missing.push(...["RESTORE_TARGET_URL"].filter((k) => !process.env[k]));
if (missing.length > 0) {
  console.error(`✗ restore-prod: missing required env vars: ${missing.join(", ")}`);
  process.exit(2);
}

const {
  RESTORE_TARGET_URL,
  BACKUP_PASSPHRASE,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
} = process.env;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ─── --list mode ────────────────────────────────────────────────────────────

if (isList) {
  const result = await s3.send(
    new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: "daily/" }),
  );
  const objs = (result.Contents ?? []).sort((a, b) =>
    (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0),
  );
  if (objs.length === 0) {
    console.log("(no backups found)");
  } else {
    for (const o of objs) {
      const sizeKb = ((o.Size ?? 0) / 1024).toFixed(1).padStart(8);
      const ts = o.LastModified?.toISOString() ?? "unknown";
      console.log(`${ts}  ${sizeKb} KB  ${o.Key}`);
    }
  }
  process.exit(0);
}

// ─── Restore mode ───────────────────────────────────────────────────────────

if (!objectKey) {
  console.error("✗ restore-prod: missing backup object key argument");
  console.error("  Run with --list to see available backups.");
  process.exit(2);
}

// Safety: refuse if RESTORE_TARGET_URL host looks like the prod URL
if (process.env.DATABASE_URL && !safetyOverride) {
  try {
    const targetHost = new URL(RESTORE_TARGET_URL.replace(/^postgres(ql)?:\/\//, "https://")).host;
    const prodHost = new URL(process.env.DATABASE_URL.replace(/^postgres(ql)?:\/\//, "https://")).host;
    if (targetHost === prodHost) {
      console.error(`✗ restore-prod: RESTORE_TARGET_URL host (${targetHost}) matches DATABASE_URL host.`);
      console.error("  This would overwrite production. If you really mean to restore over prod,");
      console.error("  re-run with --i-know-what-im-doing.");
      process.exit(1);
    }
  } catch {
    /* malformed URL — fall through */
  }
}

console.log(`→ restore-prod: about to restore ${objectKey}`);
console.log(`  target: ${RESTORE_TARGET_URL.replace(/:[^:@]+@/, ":***@")}`);
console.log("  starting in 5s — Ctrl-C to abort");
for (let i = 5; i > 0; i--) {
  process.stdout.write(`  ${i}... `);
  await new Promise((r) => setTimeout(r, 1000));
}
console.log("");

// ─── Pipeline: R2 GetObject | gpg --decrypt | gunzip | psql ─────────────────

const getResult = await s3.send(
  new GetObjectCommand({ Bucket: R2_BUCKET, Key: objectKey }),
);

const gpg = spawn(
  "gpg",
  [
    "--batch",
    "--yes",
    "--quiet",
    "--no-tty",
    "--decrypt",
    "--passphrase-fd",
    "3",
  ],
  { stdio: ["pipe", "pipe", "inherit", "pipe"] },
);
gpg.stdio[3].write(BACKUP_PASSPHRASE + "\n");
gpg.stdio[3].end();

const gunzip = spawn("gunzip", [], {
  stdio: [gpg.stdout, "pipe", "inherit"],
});

const psql = spawn(
  "psql",
  ["--single-transaction", "--set", "ON_ERROR_STOP=on", RESTORE_TARGET_URL],
  { stdio: [gunzip.stdout, "inherit", "inherit"] },
);

// Pipe R2 stream into gpg stdin
const body = getResult.Body;
if (!body) {
  console.error("✗ restore-prod: R2 returned empty body");
  process.exit(1);
}
const nodeStream = body; // SDK v3 returns a Node Readable on Node runtime
nodeStream.pipe(gpg.stdin);

// Wait for psql to finish
const psqlCode = await new Promise((resolve) => psql.on("exit", resolve));
if (psqlCode !== 0) {
  console.error(`✗ restore-prod: psql exited with code ${psqlCode}`);
  process.exit(psqlCode ?? 1);
}

console.log(`✓ restore-prod: ${objectKey} restored to target`);
