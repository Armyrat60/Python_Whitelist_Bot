# Database migrations — rules

`api/prisma/schema.prisma` is the **single source of truth** for the database
schema. Every other service (bot, seeding-service, frontend) consumes the
schema; only this directory may define it.

## How migrations are applied

- **Production:** `prisma migrate deploy` runs as the Railway `preDeployCommand`
  on the `api` service (see `railway.toml`). It runs once per deploy, before
  traffic shifts to the new container. A failed migration fails the deploy
  and Railway automatically rolls back.
- **Local dev:** `npx prisma migrate dev --create-only` to generate a new
  migration file, then review the SQL by hand before committing. Apply with
  `npx prisma migrate deploy` against your local DB.
- **Never** run `prisma db push` against any environment. It bypasses
  migration history and can cause silent data loss.
- **Never** run `prisma migrate dev` against `DATABASE_URL` if it points at
  production. It will prompt to reset the DB.

## Rules for writing migrations

1. **Additive by default.** New columns must be nullable or have a sensible
   default. New tables and indexes are always fine. Backfill data in a
   separate migration after the new column is in place.

2. **Backwards compatibility.** When changing the shape of a column or
   removing one, deploy in two phases:
   - **Phase A:** ship app code that handles BOTH the old and new shape.
     Run the additive migration (e.g. add the new column, dual-write).
   - **Phase B:** once Phase A has been live for at least one full day with
     no errors, ship app code that drops support for the old shape, then
     run the destructive migration (drop the old column).

3. **Destructive operations require explicit acknowledgement.** The
   `check-destructive-migration.mjs` script (run as part of `npm run
   db:deploy`) blocks the deploy if any of these patterns appear in a
   migration without a marker comment:
   - `DROP TABLE`
   - `DROP COLUMN`
   - `ALTER COLUMN ... TYPE`
   - `SET NOT NULL`
   - `TRUNCATE`
   - `DELETE FROM` without a `WHERE`
   - `DROP CONSTRAINT`
   - `DROP INDEX`

   To acknowledge, add a comment **on the line directly above the statement**:
   ```sql
   -- @safe-destructive: removing unused column after 2-week sunset, see PR #123
   ALTER TABLE foo DROP COLUMN bar;
   ```
   The reason is captured in the diff so reviewers can see the intent.

4. **Before deploying any flagged migration:**
   Walk through `scripts/db-snapshot-checklist.md`. The non-negotiable steps
   are: take a Railway snapshot, record its ID in the PR, and run
   `npm run db:drift` against prod to confirm zero drift before applying.

5. **The bot must never run DDL.** `bot/database.py` is read-only against
   the schema — its `verify_schema()` method only checks `_prisma_migrations`
   and refuses to start if no migrations have been applied. Do not add
   CREATE TABLE / ALTER TABLE statements there.

## Useful scripts

- `npm run db:drift` — diff live DB against `schema.prisma`. Exits non-zero on drift.
- `npm run db:deploy` — guard + apply pending migrations (this is what runs in production).
- `npm run db:migrate` — bare `prisma migrate deploy` without the guard. Avoid.
- `npm run db:generate` — regenerate the Prisma client after editing the schema.
- `npm run db:backup` — encrypted dump → Cloudflare R2. Run before any flagged migration. Also runs daily via GitHub Actions.
- `npm run db:backup:list` — list backups currently in R2.
- `npm run db:restore -- <object-key>` — restore an R2 backup into `RESTORE_TARGET_URL`. Refuses to clobber prod by accident.

## Backups

Daily encrypted dumps to Cloudflare R2 via GitHub Actions. Setup is in
`scripts/CLOUDFLARE_R2_SETUP.md`. The workflow file is
`.github/workflows/db-backup.yml`. Restore tooling and the destructive-migration
checklist are in `scripts/db-snapshot-checklist.md`.

The required GitHub Secrets (set once during setup, never in code):
`PROD_DATABASE_URL`, `BACKUP_PASSPHRASE`, `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Future work

- **Drift check in CI.** Add a GitHub Action that runs `db:drift` against a
  staging DB on every PR.
- **Restore drill on a schedule.** Add a second workflow that downloads the
  latest backup nightly, restores it into a throwaway DB, and reports back.
  Catches "the backup is corrupt" before you actually need it.
- **Adopt Prisma in seeding-service.** It currently uses raw `pg` and creates
  its own tables in `seeding-service/src/db.ts`. Migrating it to Prisma would
  remove the last DDL outside of `api/prisma`.
