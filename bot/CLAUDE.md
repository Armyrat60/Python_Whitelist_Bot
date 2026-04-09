# Bot — local rules

## Database schema

- The database schema is owned by Prisma in `api/prisma/schema.prisma`.
- **Never edit `bot/database.py` to add tables, add columns, or run DDL.**
- The bot is a read-only consumer of the schema. `Database.verify_schema()`
  checks `_prisma_migrations` on startup and refuses to start if no migrations
  have been applied — that's the only schema-related responsibility the bot
  has.
- If you need a new column or table, add it to `api/prisma/schema.prisma`,
  generate a migration with `npx prisma migrate dev --create-only` from
  inside `api/`, review the SQL, commit it, and let the API's release command
  apply it. See `api/CLAUDE.md` for the full rules.

## Schema-related helpers in this directory

- `Database.verify_schema()` — read-only health check, called from
  `setup_hook()` in `bot.py`.
- `Database.seed_global_defaults()` — idempotent INSERTs into
  `squad_permissions`. Safe to call on every startup.
- `Database.seed_guild_defaults(guild_id)` — idempotent per-guild seeding
  (default squad group, default whitelist, default panel). Called from
  `on_ready` and `on_guild_join`. **This is data seeding, not schema work**
  — keep it that way.
