#!/usr/bin/env node
/**
 * check-destructive-migration.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Hard guard that runs as part of `npm run db:deploy` BEFORE `prisma migrate
 * deploy`. Scans every migration SQL file under prisma/migrations/ for
 * destructive operations and refuses to continue unless each one is
 * explicitly acknowledged with a `-- @safe-destructive: <reason>` comment on
 * the line directly above the statement.
 *
 * This means accidental DROP COLUMN / DROP TABLE / SET NOT NULL / TRUNCATE /
 * unbounded DELETE FROM cannot reach production silently.
 *
 * Exit codes:
 *   0 — no destructive ops found, OR all destructive ops are acknowledged
 *   1 — at least one unacknowledged destructive op (deploy will fail)
 *
 * To unblock a legitimate destructive migration:
 *   1. Open the migration .sql file.
 *   2. Add a comment on the line directly above the statement, e.g.:
 *        -- @safe-destructive: dropping unused column after 2-week sunset
 *      The reason is captured in the diff so reviewers can see the intent.
 *   3. Take a Railway database snapshot and record the ID in the PR.
 *   4. Re-deploy.
 *
 * Run from anywhere (resolves prisma/migrations relative to this file's
 * location, which is api/scripts/).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "prisma", "migrations");
const MARKER = "@safe-destructive";

// Each pattern is (regex, label). The regex must match a single line. We
// strip line comments before matching so commented-out statements don't trip.
const DANGEROUS_PATTERNS = [
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
  [/\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, "ALTER COLUMN ... TYPE"],
  [/\bSET\s+NOT\s+NULL\b/i, "SET NOT NULL"],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  // DELETE FROM without a WHERE clause on the same line — heuristic, may
  // false-positive on multi-line DELETE; that's fine, the marker comment
  // unblocks it.
  [/\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i, "DELETE FROM (no WHERE)"],
  [/\bDROP\s+CONSTRAINT\b/i, "DROP CONSTRAINT"],
  [/\bDROP\s+INDEX\b/i, "DROP INDEX"],
];

/**
 * Strip line comments (-- ...) and block comments from a line for pattern
 * matching. We keep the original line for output.
 */
function stripComments(line) {
  // Remove block-comment fragments first.
  let stripped = line.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove anything after a -- comment marker.
  const dashIdx = stripped.indexOf("--");
  if (dashIdx !== -1) stripped = stripped.slice(0, dashIdx);
  return stripped;
}

function listMigrationDirs() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    console.error(`✗ Could not read ${MIGRATIONS_DIR}: ${err.message}`);
    process.exit(1);
  }
  return entries
    .filter((name) => {
      const full = join(MIGRATIONS_DIR, name);
      try {
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function checkFile(relPath, fullPath) {
  const text = readFileSync(fullPath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = stripComments(raw);
    if (!code.trim()) continue;

    for (const [re, label] of DANGEROUS_PATTERNS) {
      if (!re.test(code)) continue;

      // Look for the marker on any of the previous comment-only lines
      // immediately above this statement.
      let acknowledged = false;
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j].trim();
        if (prev === "") continue;
        if (prev.startsWith("--")) {
          if (prev.includes(MARKER)) {
            acknowledged = true;
          }
          // Keep walking up — there may be multiple comment lines.
          continue;
        }
        // Hit a non-comment, non-blank line — stop the scan.
        break;
      }

      if (!acknowledged) {
        violations.push({
          line: i + 1,
          label,
          text: raw.trim(),
        });
      }
      break; // one label per line is enough
    }
  }

  return { relPath, fullPath, violations };
}

function main() {
  const dirs = listMigrationDirs();
  const reports = [];

  for (const dir of dirs) {
    const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
    try {
      statSync(sqlPath);
    } catch {
      continue; // no migration.sql in this dir, skip
    }
    reports.push(checkFile(`prisma/migrations/${dir}/migration.sql`, sqlPath));
  }

  const offenders = reports.filter((r) => r.violations.length > 0);

  if (offenders.length === 0) {
    console.log(
      `✓ check-destructive-migration: scanned ${reports.length} migration(s), no unacknowledged destructive operations.`,
    );
    process.exit(0);
  }

  console.error(
    "✗ check-destructive-migration: destructive operations found WITHOUT a `-- @safe-destructive: <reason>` marker.\n",
  );
  for (const off of offenders) {
    console.error(`  ${off.relPath}`);
    for (const v of off.violations) {
      console.error(`    line ${v.line}: ${v.label}`);
      console.error(`      ${v.text}`);
    }
    console.error("");
  }
  console.error(
    "To unblock: add `-- @safe-destructive: <reason>` on the line directly\n" +
      "above the statement, then follow scripts/db-snapshot-checklist.md.\n" +
      "See api/scripts/check-destructive-migration.mjs for details.",
  );
  process.exit(1);
}

main();
