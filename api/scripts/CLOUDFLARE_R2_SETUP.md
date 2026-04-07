# Cloudflare R2 + GitHub Actions backup setup

One-time setup guide for the encrypted daily database backup workflow.
After this is done, you can forget about it — backups run automatically
every day at 03:00 UTC, and you can also trigger them manually before any
risky deploy.

## What this gives you

- **Daily encrypted backup** of the production Postgres → Cloudflare R2.
- **30 daily backups + 12 monthly archives** retained at any time, automatically pruned.
- **GPG AES-256 encryption** with a passphrase only stored in GitHub Secrets — even if R2 is breached, the dumps are unreadable without the passphrase.
- **Zero cost** within R2's free tier (10 GB storage, 1M writes/mo, **zero egress fees**).
- **One-click manual trigger** from the GitHub Actions tab before any risky migration.
- **Safe restore tooling** that refuses to clobber prod by accident.

## Prerequisites

- Cloudflare account with R2 enabled (free).
- GitHub repo (already exists: `Armyrat60/Python_Whitelist_Bot`).
- Production Railway Postgres connection string (the **public** one, since GitHub Actions runs outside Railway's private network).

## Step 1 — Create the R2 bucket

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**.
2. **Bucket name**: `squadwhitelister-db-backups` (must match the workflow exactly).
3. **Location**: `Automatic` (defaults to Eastern North America, closest to Railway US East).
4. **Default Storage Class**: `Standard` — **do not pick Infrequent Access**, it has retrieval fees.
5. Click **Create bucket**.

Bucket access is private by default. The workflow uses an API token, not public access. Leave it that way.

## Step 2 — Create an R2 API token (scoped to this bucket only)

1. From the R2 dashboard sidebar → **Manage R2 API Tokens** → **Create API Token**.
2. **Token name**: `github-actions-backup`
3. **Permissions**: `Object Read & Write`
4. **Specify bucket(s)**: choose **"Apply to specific buckets only"** → select `squadwhitelister-db-backups`.
   This is principle of least privilege — even if the token leaks, it can only touch this one bucket, not your whole R2 account.
5. **TTL**: `Forever` (or set a 1-year expiry and rotate annually).
6. Click **Create API Token**.

Cloudflare will show you four values **exactly once**. Copy them somewhere safe immediately — if you close the page you'll have to create a new token. You need:

- **Access Key ID**
- **Secret Access Key**
- **Account ID** (also visible in the R2 dashboard sidebar — it's the same on every page)
- The **endpoint URL** is built automatically from the account ID by the script, you don't need to copy it

## Step 3 — Generate a backup passphrase

You need a long random string for GPG to encrypt with. Generate one with whatever you trust:

```bash
# macOS / Linux / Git Bash
openssl rand -base64 48
# or
head -c 48 /dev/urandom | base64
```

Or use a password manager (Bitwarden, 1Password, KeePass) to generate a 64-character random passphrase.

**Save this passphrase somewhere you will never lose it.** If you lose the passphrase you cannot restore the backups. Recommended: store it in a password manager AND in a secondary location (encrypted file on a USB drive, paper copy in a safe, etc.).

## Step 4 — Add the secrets to GitHub

1. Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add these six secrets, one at a time. **Name them exactly as shown:**

| Secret name | Value |
|---|---|
| `PROD_DATABASE_URL` | The **public** Railway Postgres URL (starts with `postgresql://postgres:...@<host>.proxy.rlwy.net:<port>/railway`) |
| `BACKUP_PASSPHRASE` | The random passphrase you generated in step 3 |
| `R2_ACCOUNT_ID` | From step 2 |
| `R2_ACCESS_KEY_ID` | From step 2 |
| `R2_SECRET_ACCESS_KEY` | From step 2 |
| `R2_BUCKET` | `squadwhitelister-db-backups` |

GitHub encrypts secrets at rest and only the workflow runner can read them. They are never visible in the workflow logs.

## Step 5 — Test it

1. Repo → **Actions** tab → **DB Backup** workflow (left sidebar) → **Run workflow** button → enter a reason like "first test run" → **Run workflow**.
2. Wait ~30 seconds. The job should complete with a green check.
3. Click into the run and verify the logs show:
   - `pg_dump (PostgreSQL) 16.x`
   - `→ backup-prod: starting pg_dump → gzip → gpg → R2 (daily/prod-...)`
   - `✓ backup-prod: uploaded daily/prod-... to bucket "squadwhitelister-db-backups"`
   - `✓ prune-backups: ...`
4. Go to the R2 dashboard → your bucket → confirm the file is there.

## Step 6 — Verify you can list and restore

From your local machine, with the same env vars set:

```bash
cd api
R2_ACCOUNT_ID="..."  R2_ACCESS_KEY_ID="..."  R2_SECRET_ACCESS_KEY="..."  R2_BUCKET="squadwhitelister-db-backups" \
  npm run db:backup:list
```

You should see your test backup. To do a real restore drill, spin up a local Postgres DB (via Docker, brew, or a fresh Neon/Supabase free DB) and restore into it. **Never restore into prod for testing.** See `db-snapshot-checklist.md` for the restore commands.

## Done — what happens next

- The backup workflow runs every day at **03:00 UTC** automatically.
- After ~30 days you'll have 30 daily files + 1 monthly archive in R2, total maybe 30 MB.
- After ~365 days, you'll have 30 daily files + 12 monthly archives, total maybe 100 MB.
- All well within the 10 GB free tier.

## Troubleshooting

**`pg_dump: server version mismatch`** — The workflow installs PostgreSQL 16 client to match Railway. If Railway upgrades to PG 17+, bump the version in `.github/workflows/db-backup.yml` (line `postgresql-client-16`).

**`could not connect to server`** — `PROD_DATABASE_URL` is wrong or you used the private (`postgres.railway.internal`) URL instead of the public one. GitHub Actions runs outside Railway's private network and needs the proxy URL.

**`gpg: WARNING: passphrase given on command line`** — should not happen, the script uses `--passphrase-fd 3`. If you see it, the script was modified incorrectly.

**`AccessDenied` on R2 upload** — the API token doesn't have write permission, or doesn't include the bucket. Re-check step 2.

**Workflow runs but R2 bucket stays empty** — check the workflow logs for errors. The most common cause is a typo in one of the R2 secrets.

## Rotating the credentials

If you suspect any of the secrets have leaked:

1. **R2 token**: Cloudflare dashboard → R2 → Manage API Tokens → roll the token, paste the new values into GitHub Secrets.
2. **Backup passphrase**: generate a new one, update `BACKUP_PASSPHRASE` in GitHub Secrets. **Old backups stay encrypted with the old passphrase** — keep the old passphrase archived too if you might need to restore from before the rotation.
3. **Database URL**: Railway dashboard → Postgres service → reset the DB password, paste the new connection string into GitHub Secrets.

## Future improvements

- **Restore drill on a schedule.** Add a second workflow that downloads the latest backup, restores it into a throwaway Neon/Supabase DB, runs `prisma migrate status` against it, and reports back. Catches "the backup is corrupt" before you actually need it.
- **Multi-region.** Add a second bucket in a different R2 jurisdiction and have the workflow upload to both.
- **Replace the manual passphrase with a GPG keypair** stored in HashiCorp Vault or 1Password Connect for finer-grained access control.
