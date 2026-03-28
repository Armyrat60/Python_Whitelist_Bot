# UX & flow recommendations — summary

Handy checklist derived from product and codebase reviews (Discord bot, marketing site, member portal, mod dashboard).

---

## Re-analysis (2026-03-27)

Snapshot of **current behavior** after recent changes (guild UX, org theming, Playwright, health checks).

### What improved

| Area | Details |
|------|---------|
| **Guild switch** | `use-guild`: after `/api/guilds/switch`, **`queryClient.clear()`** + **`router.refresh()`** so guild-scoped data does not leak across servers. |
| **Guild UI** | **Sidebar** includes **`SidebarGuildCard`** (popover + searchable list) with a brief **flash** on change — especially useful on **mobile**, where the top bar **GuildSwitcher** stays **`md+` only**. |
| **Top bar** | **Managing {guild name}** under the page title; **GuildSwitcher** on desktop beside the title block. |
| **Org theming** | Guild settings can set **`accent_primary` / `accent_secondary`**; **`/api/guild/theme`** + **`OrgThemeSync`** apply them app-wide and **override** personal `localStorage` accents when both org colors are set. |
| **Playwright** | Config targets **`https://squadwhitelister.com`** by default (`BASE_URL` overridable); **`workers: 1`**, **`fullyParallel: false`**, longer timeouts to reduce **Cloudflare 429** on live runs. Suites include **portal**, **security**, plus existing smoke/pages/API tests. |
| **Health / ops** | **Role sync** timestamp + **admin health** staleness hints (when bot/API changes are present). |

### Codebase / deploy (not UX-only, but affects flow)

- **`bot/web_routes/api.py`** remains very large (~4k+ lines) — future splits by domain will help maintenance.
- **`next.config.ts`**: prefer **env-only `BACKEND_URL`** in production; remove or gate the **hardcoded Railway** fallback for forks and safer deploys.

### Open UX / polish (unchanged priorities)

- **WL Roster:** stronger **primary actions** (+ Add User), optional **density** toggle.
- **⌘K:** `cmdk` / `CommandDialog` exist in UI primitives but **no global command palette** mounted in the app shell yet.
- **Deep routes:** **breadcrumbs** or consistent back links on **Settings**, **Import/Export**, **Tiers**.
- **Homepage:** align **“Analytics”** (and similar) with real dashboard capabilities or **soften copy**.
- **Discord:** **single-whitelist** servers — auto-default type in `/whitelist` (bot-side).
- **Portal empty states:** optional **`NEXT_PUBLIC_SUPPORT_URL`** (or Discord invite) CTA.

### Assets

- Replace **`/hero-dashboard.png`** / refine **`/logo.png`** with **real screenshots** and brand art when ready (user-supplied).

---

## Verification notes (historical / integration work)

| Area | What landed | Notes |
|------|-------------|--------|
| **My Whitelist** | Guild header (“Whitelist Portal” + server avatar/name); error/empty copy references **active guild** | |
| **Health / ops** | `last_role_sync_at` after daily role sync; admin health warns if sync **> ~26h** | |
| **Tests** | `portal.spec.ts`, `security.spec.ts`, plus smoke/pages/API | Run with **`BASE_URL`** aligned to target env; live runs respect rate limits |

**Still watch:** **`BACKEND_URL`** in Next — should be set explicitly on **Railway** / CI, not relied on as a baked-in hostname.

---

## UX checklist

### Cross-surface

- [x] **Discord ↔ web:** `/help` links to **My Whitelist**; portal explains parity with `/whitelist`.
- [x] **Homepage:** Member vs Staff CTAs; Steam64 / EOS `abbr` tooltips.
- [x] **Hero image:** `/hero-dashboard.png` (swap for real dashboard capture when available).

### Discord bot

- [x] **`/help`:** Member section includes **Website → /my-whitelist** link.
- [ ] **Single-whitelist servers:** Default whitelist in `/whitelist` when only one exists (future).

### My Whitelist (web)

- [x] **Unsaved changes:** `beforeunload` when slots differ from baseline; baseline updates after successful save.
- [ ] **Support link:** Optional public env for invite/support URL in empty states (future).

### Mod dashboard

- [x] **Orientation:** “Managing {guild}” under page title (desktop).
- [x] **Guild switcher:** Desktop — top bar; **Mobile / all sizes** — **sidebar** guild card + popover (top bar switcher remains `md+`).
- [x] **Org accent colors:** Stored per guild; applied globally when set (overrides user preset).
- [ ] **Roster / dense pages:** Stronger **primary action**, optional density toggle (future).
- [ ] **⌘K** global command palette (future).
- [ ] **Breadcrumbs** on deep settings/import pages (future).

### Copy / trust

- [ ] Homepage **Analytics** (etc.) matches product or wording is softened.

---

## Hero images & logo

- **`frontend/public/logo.png`** — referenced as **`/logo.png`** across shell and marketing.
- **`frontend/public/hero-dashboard.png`** — landing hero; replace with **authentic** dashboard screenshots when available.
- **Playwright** `page.screenshot` is the right tool for **pixel-accurate** marketing captures once auth/session is scripted.

---

*Last updated: 2026-03-27 — re-analysis merged with UX checklist.*
