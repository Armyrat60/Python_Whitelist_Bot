#!/usr/bin/env node
/**
 * prune-backups.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Enforces retention on the R2 backup bucket. Keeps:
 *   - the last 30 daily backups (anything in daily/ newer than 30 days)
 *   - the FIRST backup of each calendar month for the last 12 months
 *     (acts as a long-term archive without needing a separate prefix)
 *
 * Anything older than that gets deleted. Run after backup-prod.mjs in the
 * same workflow.
 *
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const REQUIRED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`✗ prune-backups: missing required env vars: ${missing.join(", ")}`);
  process.exit(2);
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const DAILY_RETENTION_DAYS = 30;
const MONTHLY_RETENTION_MONTHS = 12;

function ymKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const all = [];
let token;
do {
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: "daily/",
      ContinuationToken: token,
    }),
  );
  all.push(...(result.Contents ?? []));
  token = result.IsTruncated ? result.NextContinuationToken : undefined;
} while (token);

console.log(`→ prune-backups: bucket has ${all.length} objects under daily/`);

const now = Date.now();
const dailyCutoff = now - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const monthlyCutoff = now - MONTHLY_RETENTION_MONTHS * 31 * 24 * 60 * 60 * 1000;

// Sort newest first
all.sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));

// Group "first of month" survivors: walk oldest→newest within each YYYY-MM
// and keep only the EARLIEST entry per month within the monthly window.
const firstOfMonth = new Map(); // ym -> object
for (const obj of all) {
  const t = obj.LastModified?.getTime() ?? 0;
  if (t < monthlyCutoff) continue;
  const ym = ymKey(obj.LastModified ?? new Date(t));
  const existing = firstOfMonth.get(ym);
  if (!existing || (existing.LastModified?.getTime() ?? 0) > t) {
    firstOfMonth.set(ym, obj);
  }
}

const keepKeys = new Set();
for (const obj of all) {
  const t = obj.LastModified?.getTime() ?? 0;
  if (t >= dailyCutoff) keepKeys.add(obj.Key);
}
for (const obj of firstOfMonth.values()) {
  keepKeys.add(obj.Key);
}

const toDelete = all.filter((o) => !keepKeys.has(o.Key));

if (toDelete.length === 0) {
  console.log(`✓ prune-backups: nothing to delete (kept ${keepKeys.size})`);
  process.exit(0);
}

console.log(`→ prune-backups: deleting ${toDelete.length} object(s), keeping ${keepKeys.size}`);

// DeleteObjects supports up to 1000 keys per call
for (let i = 0; i < toDelete.length; i += 1000) {
  const batch = toDelete.slice(i, i + 1000);
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: {
        Objects: batch.map((o) => ({ Key: o.Key })),
      },
    }),
  );
  for (const o of batch) console.log(`  deleted ${o.Key}`);
}

console.log(`✓ prune-backups: done`);
