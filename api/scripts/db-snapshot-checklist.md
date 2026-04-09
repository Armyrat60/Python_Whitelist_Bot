# Database backup checklist

Run through this checklist **every time** you are about to apply a migration
that the destructive-migration guard has flagged (or any other change that
touches existing data).

This is the manual half of our data-protection contract. The automated half
is `check-destructive-migration.mjs`. Together they make sure no DROP /
ALTER TYPE / TRUNCATE / unbounded DELETE reaches production silently.

## Before deploying

- [ ] **Trigger a fresh backup.**
  Two ways, pick one:
  - **From the GitHub Actions UI** (preferred):
    Repo → Actions → "DB Backup" → "Run workflow" → enter a reason
    (e.g. "before migration to drop foo column") → Run.
    Wait for the green check (~30 seconds). The dump is now in R2.
  - **From your local machine**, if Actions is unavailable:
    ```bash
    cd api
    DATABASE_URL="<prod-url>"          \
    BACKUP_PASSPHRASE="<passphrase>"   \
    R2_ACCOUNT_ID="<id>"               \
    R2_ACCESS_KEY_ID="<key>"           \
    R2_SECRET_ACCESS_KEY="<secret>"    \
    R2_BUCKET="squadwhitelister-db-backups" \
    npm run db:backup
    ```
  - Record the backup object key in the PR description: `backup: daily/prod-YYYY-MM-DD-HHMM.sql.gz.gpg`.
- [ ] **Run the drift check.**
  ```bash
  cd api && DATABASE_URL="<prod-url>" npm run db:drift
  ```
  Must exit 0. If it reports drift, STOP and reconcile first.
- [ ] **Read the migration SQL one more time.**
  - Open `api/prisma/migrations/<timestamp>_*/migration.sql`.
  - Confirm that every flagged statement has a `-- @safe-destructive: <reason>` comment.
  - Confirm the reasons make sense and that the statement matches the intent in the PR.
- [ ] **Backwards-compat check.**
  - Will the *currently running* application code work after this migration runs?
  - If you are dropping a column, the running code must already have stopped reading it.
  - If you are renaming a column, deploy the rename in two phases (add new → backfill → cut over reads → drop old).
- [ ] **Confirm git state.**
  - Working tree is clean.
  - You are deploying from `main` (or the explicit release branch).
- [ ] **Document the rollback plan in the PR.**
  - One-liner: "If this breaks, restore backup `<key>` and revert commit `<sha>`."

## After deploying

- [ ] Watch Railway logs for the `prisma migrate deploy` step. It should print
      `Applied migration: <name>` and exit 0.
- [ ] Smoke-test the affected feature in production.
- [ ] If anything looks off, restore the backup (see below) and revert the commit.

## How to restore

**The restore script is intentionally hard to point at production by accident.**
It refuses to run unless `RESTORE_TARGET_URL` is explicitly set, and refuses
again if that URL host matches the prod URL host (unless you also pass
`--i-know-what-im-doing`).

### List available backups

```bash
cd api
R2_ACCOUNT_ID="<id>"               \
R2_ACCESS_KEY_ID="<key>"           \
R2_SECRET_ACCESS_KEY="<secret>"    \
R2_BUCKET="squadwhitelister-db-backups" \
npm run db:backup:list
```

### Restore into a *fresh, separate* database first to verify

This is the safe path: spin up a throwaway local Postgres or a brand-new
Railway PG service, restore into it, sanity-check the data, then either
swap your app over to it OR copy specific tables back to prod.

```bash
cd api
RESTORE_TARGET_URL="postgresql://localhost:5432/restore_test" \
BACKUP_PASSPHRASE="<passphrase>"                              \
R2_ACCOUNT_ID="<id>"                                          \
R2_ACCESS_KEY_ID="<key>"                                      \
R2_SECRET_ACCESS_KEY="<secret>"                               \
R2_BUCKET="squadwhitelister-db-backups"                       \
npm run db:restore -- daily/prod-2026-04-06-0300.sql.gz.gpg
```

### Restore directly over production (DANGEROUS)

Only do this if (a) you have a fresher backup of the current corrupted state,
and (b) you have already confirmed the chosen backup is good by restoring it
to a test target first.

```bash
DATABASE_URL="<prod-url>"                  \
RESTORE_TARGET_URL="<prod-url>"            \
BACKUP_PASSPHRASE="<passphrase>"           \
... (rest as above)                        \
npm run db:restore -- daily/prod-... --i-know-what-im-doing
```

## Why this exists

Hobby plan Railway does not include managed database backups. We replace that
with a daily encrypted dump to Cloudflare R2 (10 GB free tier, zero egress
fees). The dump is GPG-encrypted with a passphrase that lives only in GitHub
Secrets — even if someone got access to the R2 bucket, they cannot read the
data. See `CLOUDFLARE_R2_SETUP.md` for the full setup.
