# Squad Whitelister — Project Roadmap & Progress Tracker
Last updated: 2026-03-29

## Naming Conventions (Decided)
- **Discord Roster** — automated, role-based whitelist (was "WL Roster")
- **Manual Roster** — admin-curated, category/clan-based whitelist
- **Roster** — parent concept for both
- **Category** — named group within a Manual Roster (e.g. [DeadMansHand], [VIP])

---

## ✅ Completed

### Core System
- [x] Discord OAuth login
- [x] Guild switcher (multi-server support)
- [x] Session management (in-memory, known limitation)
- [x] TypeScript/Fastify API deployed on Railway
- [x] Next.js frontend deployed on Railway
- [x] Python Discord bot deployed on Railway
- [x] PostgreSQL on Railway (shared by bot + API)

### Discord Roster (Role-Based)
- [x] Panel embeds — players self-register via Discord channel buttons
- [x] Role-based slot limits (PanelRole model)
- [x] Stackable roles
- [x] Auto-deactivate on role loss
- [x] Multiple panels per whitelist (different channels, different role requirements)
- [x] Whitelist output file generation (served via HMAC-signed URL)
- [x] Squad group mapping

### Manual Roster (Category-Based)
- [x] `is_manual` flag on Whitelist model
- [x] WhitelistCategory model (name, slot_limit, sort_order)
- [x] CategoryManager model (scoped access by Discord ID)
- [x] Full CRUD API for categories and managers
- [x] Category entry API (GET/POST/DELETE entries per category)
- [x] Steam-only entries (synthetic Discord ID for players without Discord)
- [x] Slot limit enforcement per category (409 if full)
- [x] Frontend: Manual Roster dedicated page in sidebar
- [x] Frontend: Category list → entry drilldown view
- [x] Frontend: Add entry form (Steam ID + optional Discord info + notes + expiry)
- [x] Frontend: Manager assignment per category

### UI / Navigation
- [x] Sidebar nav with sections
- [x] Whitelists page split: Discord Whitelists + Manual Rosters sections
- [x] Panels page with Access Roles (PanelRole) configuration
- [x] Settings, Notifications, Import/Export pages
- [x] Audit Log page

### Security (Audit Fixes — 2026-03-29)
- [x] Fixed critical auth bypass: missing `return` in requireAdmin/requireAuth
- [x] Steam names route now requires authentication
- [x] WEB_SESSION_SECRET throws in production if unset

---

## 🔄 In Progress / Next Up

### Phase 1 — Navigation & UI Cleanup (Quick Wins)
- [x] Rename "WL Roster" → "Discord Roster" in sidebar
- [x] Rename "Manual Roster" confirmed name in sidebar
- [x] Move Audit Log from main nav to Settings section
- [x] Restructure sidebar sections: ROSTERS / PLAYERS / MANAGE / SETTINGS
- [x] Add Profiles & Player Search to nav (placeholder pages)
- [x] "My Whitelist" page update — status badge, category, expiry, read-only for Manual Roster entries

---

## 📋 Backlog

### Player Profiles
- [x] Dedicated profile page per player (`/dashboard/players/:discordId`)
- [x] Show: Discord info, all Steam IDs + names, EOS IDs, whitelist membership, category, expiry, notes, audit history
- [x] Link Steam ID to steamcommunity.com profile
- [x] Profile accessible from any roster view (click player name → ExternalLink icon)
- [ ] "Unverified Steam" badge until Steam verification done
- [ ] Edit player info from profile (notes, expiry, category reassignment)

### Player Search
- [x] Dedicated `/dashboard/search` page — search by name, Steam ID, EOS ID, Discord ID
- [x] Results show which whitelist/category they're on, status, expiry
- [x] Click result → navigates to player profile
- [ ] Quick actions from search result (remove, edit inline)

### Permissions & Access Control
- [ ] Expanded permission levels:
  - Guild Owner — full access (current)
  - Admin — MANAGE_GUILD or mod role (current)
  - Roster Manager — can manage specific Manual Roster categories
  - Viewer — read-only dashboard access
  - Category Manager — already built (Discord ID scoped to one category)
- [ ] Permissions page: show all users with dashboard access + their level
- [ ] Grant dashboard access without requiring Discord admin perms
- [ ] Permission audit trail (log who granted/revoked access)
- [ ] Role-based UI: hide actions the user doesn't have permission for

### Steam Integration
- [ ] Steam API verification — verify player owns Steam account
- [ ] Steam name display next to Steam ID in all roster views (in progress via /steam/names)
- [ ] Steam avatar display on player profiles
- [ ] Link Discord account → Steam account (player self-links via My Whitelist page)
- [ ] "Verified" badge on confirmed Steam accounts
- [ ] Steam ID format validation (Steam64, 17-digit starting with 7656119)

### SquadJS MySQL Bridge (Read-Only)
- [ ] Read-only connection config to SquadJS MySQL database
- [ ] Import tables: `server_players`, `server_admins`, player history
- [ ] Match SquadJS Steam IDs against existing whitelist entries
- [ ] Show playtime, last seen, kill/death from SquadJS data on player profiles
- [ ] Import player data as whitelist entries (with source = "squadjs_import")
- [ ] Ban history check via SquadJS data
- [ ] Import/Export page: "Import from SquadJS" option
- [ ] Config: SquadJS MySQL host/user/pass/db settings page

### BattleMetrics API Integration
- [ ] BattleMetrics API key config in settings
- [ ] Player lookup: ban history, server playtime, aliases
- [ ] Show BM data on player profiles
- [ ] Flag players with recent bans on whitelist submission
- [ ] Auto-reject or flag submissions from banned players

### Discord Bot Updates
- [ ] Panel embed for Manual Roster managers (manage their category via Discord)
- [ ] `/roster` command — managers add/remove players from their assigned category
- [ ] `/roster list` — show current category members
- [ ] `/roster add <steamid> [name]` — add player to category
- [ ] `/roster remove <steamid>` — remove player from category
- [ ] Updated `/my_whitelist` — show category, expiry, Steam ID, status
- [ ] Notification embeds — audit events → Discord channel webhooks
- [ ] Permission-aware commands (check manager role before allowing /roster)

### Notifications (Webhook)
- [ ] Complete notification system (currently stubbed)
- [ ] Events: user added/removed, whitelist expiring, category full, role sync errors
- [ ] Route events to configured Discord channels
- [ ] Notification preview in UI

### Data & Compliance
- [ ] Enforce `retention_days` setting — cleanup job for expired entries
- [ ] Data export per user (GDPR-style: "export my data")
- [ ] Bulk expiry management (set expiry on all entries in a category)
- [ ] Audit log expansion: settings changes, panel edits, group changes (currently only user/whitelist mutations logged)

### My Whitelist Page (Player Self-Service)
- [ ] Show which whitelist(s) player is on
- [ ] Show category assignment (if Manual Roster)
- [ ] Show Steam IDs linked + verification status
- [ ] Show expiry date with countdown
- [ ] Allow player to link/unlink Steam account
- [ ] Show slot limit and current usage
- [ ] Status badge: Active / Expiring Soon / Expired

### Infrastructure
- [ ] Session persistence (in-memory store loses sessions on restart)
  - Option A: Redis session store
  - Option B: PostgreSQL session store (connect-pg-simple)
- [ ] Rate limiting on all API routes (currently only file serving)
- [ ] Global request rate limiting (100 req/min per IP)
- [ ] Audit log pagination + archival for large guilds
- [ ] Metrics/observability (Prometheus or similar)
- [ ] `.env.example` documentation for all required env vars

---

## 🗓 Suggested Phase Order

| Phase | Focus | Effort |
|---|---|---|
| **1** | Nav rename, sidebar restructure, Audit Log move | Small |
| **2** | My Whitelist page update, Steam ID display improvements | Small |
| **3** | Player Profiles + Player Search | Medium |
| **4** | Permissions page + expanded access control | Medium |
| **5** | Discord bot updates (roster commands, notifications) | Medium |
| **6** | SquadJS MySQL bridge | Medium |
| **7** | Steam verification + account linking | Large |
| **8** | BattleMetrics API | Large |
| **9** | Session persistence, rate limiting, observability | Large |

---

## Architecture Notes

### Data Flow
```
Discord Roster:   Discord Role → Panel Embed → Self-Register → whitelist_users (status=active)
Manual Roster:    Admin/Manager → Dashboard or Discord command → whitelist_users (category_id set)
Output:           Both → merged whitelist .txt file → Squad server polls via HMAC URL
```

### Key Models
- `whitelists` — whitelist definition (role-based or manual)
- `panels` — Discord channel panel (embeds, buttons)
- `panel_roles` — role → slot limit mapping per panel
- `whitelist_users` — player on a whitelist (Discord ID indexed)
- `whitelist_identifiers` — Steam IDs / EOS IDs per player
- `whitelist_categories` — named groups within a manual whitelist
- `category_managers` — Discord IDs with scoped category access
- `audit_logs` — admin action history

### Services
- `api/` — TypeScript/Fastify REST API (Railway: squadwhitelister-api)
- `frontend/` — Next.js dashboard (Railway: frontend, domain: squadwhitelister.com)
- `bot/` — Python Discord bot (Railway: bot-worker)
- PostgreSQL — shared DB on Railway internal network

### Deployment Commands
- API: `railway up api/ --path-as-root --service squadwhitelister-api --detach`
- Bot: `railway up --service bot-worker --detach` (from project root)
- Frontend: `railway up frontend/ --path-as-root --service frontend --detach`
- Frontend also auto-deploys from GitHub push to main (sometimes needs CLI push to bust cache)
