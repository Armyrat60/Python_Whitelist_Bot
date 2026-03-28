# Squad Whitelister — consolidated suggestions (handoff for Claude / other AI)

Use this document as context for follow-up work. It summarizes recommendations from a codebase and product review (frontend theme, architecture, security, ops).

---

## Product context

- **Live:** Railway, public site **https://squadwhitelister.com** (confirm apex vs `www` and Discord OAuth redirect URIs match).
- **Stack:** Next.js 16 UI + Python **aiohttp** API (OAuth, sessions, DB, Discord bot integration, GitHub whitelist publishing). Frontend proxies `/api`, `/login`, `/callback`, `/logout` to Python via `BACKEND_URL` in `next.config.ts`.

---

## UI / theme (already implemented in repo in part)

**Problems called out**

- Old theme felt like too much black, muddy blue-green background, competing cyan/indigo/teal.
- User likes dark mode but wanted less “weird” tinted canvas.

**Changes made (direction)**

- **Neutral dark grays** for surfaces (`oklch` with **zero chroma** on background, cards, sidebar, top bar) — no blue wash.
- **Removed** the `body` **radial gradient**; flat `bg-background` only.
- **Default accent preset “Nocturne”:** violet `#a78bfa` + amber `#fbbf24` (stored in `accent-context.tsx` + `globals.css` defaults).
- User may still see **Night Vision** (lime + cyan) or **Precision Intel** (cyan + indigo) from **`localStorage`** key `squad-wl-accent` or Settings → Appearance.

**Further UI ideas**

- Consider **one** primary accent for main actions (e.g. **+ Add User** aligned with nav active) vs splitting primary/secondary across the page.
- Optional **comfortable/compact** density for the WL Roster table.
- **Playwright screenshots:** automated **PNG captures of a real browser** after visiting a URL — useful for post-deploy visual checks; repo already has `@playwright/test` in the frontend.

---

## Architecture opinion — “separate API service?”

**Conclusion:** The **Python aiohttp app already is the API**. Next.js is UI + reverse proxy. That **two-service** split (frontend vs backend) is appropriate.

**Do not** add a third API layer or duplicate APIs in Node unless there is a concrete need (e.g. multi-team ownership, very different scaling, strict isolation).

**Optional evolution:** Run **`python -m bot web`** as a dedicated web/API worker separate from the Discord gateway bot if one process is overloaded — still one codebase, not a new technology.

---

## Deep-dive findings & prioritized recommendations

### A. Production / environment (high impact)

- Set explicitly on Railway (or equivalent): `WEB_BASE_URL`, `FRONTEND_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, **`WEB_SESSION_SECRET`** (strong random), **`WEB_FILE_SECRET`** (stable across deploys if `/wl/` token URLs must not change), **`CORS_ORIGIN`** = exact frontend origin (e.g. `https://squadwhitelister.com`).
- **Discord OAuth** redirect must match the registered `…/callback` and **`WEB_BASE_URL`**.
- **`next.config.ts`** should not rely on a **hardcoded** old `*.up.railway.app` default for `BACKEND_URL` — use env-only in production.
- Pick **one canonical host** (apex vs `www`); align CORS + OAuth + cookies.

### B. Codebase health

- **`bot/web_routes/api.py` is very large** — consider splitting by domain (guild, roster, settings, import/export) into modules that register routes.
- **`frontend/.../dashboard/users/page.tsx` is very large** — extract hooks, dialogs, and table sections.
- **`next-auth`** is in `package.json` but auth is **custom** (`/api/auth/session` on Python). **Remove** `next-auth` or adopt it fully — avoid dead dependency.

### C. Security & reliability

- **Rate limiting** is **in-memory** per process; multiple API replicas get inconsistent limits — consider Redis or edge limits if scaling horizontally.
- **REST-only / standalone web** mode relies on session-stored mod flags in some paths — keep **session secret** strong; document threat model.
- Optional: enable **`SENTRY_DSN`** (already referenced in config) on both Python and Next if not already.

### D. Testing

- **CI** runs Python **ruff** + compile and frontend **build**; **no Python tests** were present when last checked — add targeted tests for auth decorators, whitelist/slot rules, import paths.
- Extend **Playwright** for smoke or staging screenshots after deploy if desired.

### E. Docker / local dev note

- `docker-compose.yml` uses **Postgres** for the stack; README still emphasizes MariaDB/MySQL in places — keep docs aligned with how you actually deploy (Railway DB type).

---

## Quick checklist to share with another agent

1. Confirm theme deploy: latest `globals.css` + neutral background + no body gradient on production.
2. Confirm `squad-whitelister` env vars and **`BACKEND_URL`** on the Next service.
3. Remove or use **`next-auth`**.
4. Plan incremental splits of **`api.py`** and **`users/page.tsx`**.
5. Add **Python tests** for critical paths.
6. If scaling to **multiple API replicas**, address **distributed rate limiting**.

---

*Generated as a handoff summary; adjust any Railway/env names to match the user’s actual services.*
