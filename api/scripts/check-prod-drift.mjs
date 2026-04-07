#!/usr/bin/env node
/**
 * check-prod-drift.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Compares the schema of the database at $DATABASE_URL against
 * api/prisma/schema.prisma and exits non-zero if there is any drift.
 *
 * Run BEFORE:
 *   - the one-time `prisma migrate resolve --applied <baseline>` reconcile
 *   - any deploy that contains a destructive migration
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node api/scripts/check-prod-drift.mjs
 *
 * Implementation: just delegates to `prisma migrate diff --exit-code`. We
 * keep it as a wrapper so the rest of the runbook can call `npm run
 * db:drift` without remembering the flags.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(__dirname, "..");

if (!process.env.DATABASE_URL) {
  console.error("✗ check-prod-drift: DATABASE_URL is not set.");
  console.error("  Set it to the URL of the DB you want to compare against.");
  console.error('  e.g. DATABASE_URL="postgresql://..." npm run db:drift');
  process.exit(2);
}

console.log("→ check-prod-drift: diffing live DB against schema.prisma…");

const result = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-url",
    process.env.DATABASE_URL,
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--exit-code",
  ],
  {
    cwd: apiDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.status === 0) {
  console.log("✓ check-prod-drift: no drift detected.");
  process.exit(0);
}

if (result.status === 2) {
  console.error("");
  console.error("✗ check-prod-drift: drift detected between the live DB and schema.prisma (see diff above).");
  console.error("");
  console.error("  This means the live DB has tables/columns/indexes that schema.prisma");
  console.error("  does not know about, OR vice versa. Investigate before continuing.");
  console.error("");
  console.error("  DO NOT run a destructive migration or `migrate resolve --applied`");
  console.error("  until this is reconciled. See scripts/db-snapshot-checklist.md.");
  process.exit(2);
}

console.error(`✗ check-prod-drift: prisma migrate diff failed with exit code ${result.status}`);
process.exit(result.status ?? 1);
