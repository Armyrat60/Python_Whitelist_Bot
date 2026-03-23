
# Squad Whitelist Bot

Discord bot for managing Squad game server whitelist entries (RemoteAdminList format) with MariaDB/MySQL, GitHub publishing, and a built-in web server.

## What it does

- Stores whitelist ownership per Discord user
- Supports **Subscription** and **Clan** whitelist types
- Supports **Steam64** and **EOSID** identifiers
- Tracks slot limits by role mapping, with optional moderator override
- Automatically disables whitelist output when a user loses the required role
- Automatically removes users from active output when they leave the Discord
- Publishes whitelist files to **GitHub** and serves them via **built-in web server**
- Configurable **Squad permission groups** (reserve, cameraman, admin, etc.)
- Keeps audit history and weekly or daily reports

## Main features

- Interactive `/setup` wizard with dropdowns and toggle buttons
- **Built-in web server** — serve whitelist files at a URL (with optional SSL/TLS)
- **Squad group management** — create custom groups with any combination of Squad's 21 permissions
- **Per-type group assignment** — subscription and clan types can use different permission groups
- Separate enable/disable for subscription and clan whitelists
- Output modes: `combined`, `separate`, `hybrid`
- Per-type panel and log channels (set via channel dropdowns)
- Role mappings via role select menus
- Duplicate output dedupe before publishing
- 90-day retention by default

## Requirements

- Python 3.10+
- MariaDB or MySQL
- Discord bot token
- GitHub personal access token with repo content write access

## Installation

1. Copy `.env.example` to `.env` and fill in your values.

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create the database first.
   The bot will create its own tables inside that database.

4. Start the bot:
   ```bash
   python bot.py
   ```

## Environment file

Required:
- `DISCORD_TOKEN` — Discord bot token
- `GUILD_ID` — Target Discord server ID
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — Database connection
- `GITHUB_TOKEN` — GitHub personal access token
- `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` — GitHub repo for publishing
- `WHITELIST_FILENAME` — Default combined output filename

Optional:
- `BOOTSTRAP_MOD_ROLE_ID` — Pre-set moderator role ID
- `WEB_ENABLED` — Enable built-in web server (default: `true`)
- `WEB_HOST` — Web server bind address (default: `0.0.0.0`)
- `WEB_PORT` — Web server port (default: `8080`)
- `WEB_BASE_PATH` — URL base path (default: `/`)
- `SSL_CERT_PATH` — Path to SSL certificate (fullchain.pem) for HTTPS
- `SSL_KEY_PATH` — Path to SSL private key (privkey.pem) for HTTPS
- `WEB_DISK_PATH` — Also write output files to this directory (for external web servers)

## Web server

The bot includes a built-in HTTP server that serves whitelist files as plain text. This lets Squad servers pull the RemoteAdminList directly from a URL.

- Default: `http://your-server:8080/PhantomCoWhitelist.txt`
- With SSL: `https://your-domain:8080/PhantomCoWhitelist.txt`
- Index: `http://your-server:8080/` lists all available files

To use with a custom domain (e.g. `staff.dmhwhitelist.com/wl`):
1. Point your domain to the server running the bot
2. Set `SSL_CERT_PATH` and `SSL_KEY_PATH` for HTTPS
3. Or use `WEB_DISK_PATH` to write files to disk and serve with nginx/apache

## Squad groups and permissions

The bot generates output in Squad's RemoteAdminList format:

```
Group=Whitelist:reserve

Admin=76561198xxxx:Whitelist // username
Admin=76561199xxxx:Whitelist // othername [EOS]
```

Groups are fully configurable. All 21 Squad permissions are available:
`startvote, changemap, pause, cheat, private, balance, chat, kick, ban, config, cameraman, immune, manageserver, featuretest, reserve, demos, clientdemos, debug, teamchange, forceteamchange, canseeadminchat`

Use `/setup` > **Groups** to:
- Create custom groups (e.g. `Staff:kick,ban,chat,cameraman,reserve`)
- Edit permissions on existing groups
- Delete non-default groups

Each whitelist type (subscription/clan) can be assigned to a different group via the type settings.

## First-time setup

1. Start the bot
2. Run `/setup_mod_role` to set the moderator role (bootstrap — only needed once)
3. Run `/setup` to open the interactive setup wizard
4. In the wizard:
   - Set the **Moderator Role** (dropdown)
   - Click **Global Settings** to set output mode, retention, and report frequency
   - Click **Groups** to create/manage Squad permission groups
   - Click **Subscription** or **Clan** to configure each type:
     - Toggle enabled, GitHub, stack roles
     - Pick panel and log channels from dropdowns
     - Add role mappings by selecting a role, then entering a slot count
     - Set the default slot limit
     - Use **More Options** to set Squad group and edit GitHub filename
   - Use **Remove Sub/Clan Role Mapping** buttons to remove existing mappings
   - Click **Refresh** to see updated values
5. Run `/whitelist_panel` to post the user-facing panel

## Commands

### User
- `/whitelist` — Submit or update your whitelist IDs
- `/my_whitelist` — View your saved IDs and slots
- `/status` — View bot configuration
- `/ping` — Check bot health (DB, GitHub, web server)
- `/help` — Show command reference

### Admin
- `/setup` — Interactive setup wizard (channels, roles, groups, settings)
- `/setup_mod_role` — Set the moderator role (first-time bootstrap)
- `/whitelist_panel` — Post or refresh a whitelist panel
- `/resync_whitelist` — Force GitHub + web sync

### Moderator
- `/mod_view` — View a user's whitelist
- `/mod_set` — Replace a user's IDs
- `/mod_remove` — Remove user from active output
- `/mod_override` — Set or clear a slot override
- `/report_now` — Generate an ad-hoc report

## How slot ownership works

Slot limits are tracked **per Discord user, per whitelist type**.

Example:
- A user can have a subscription whitelist with 4 slots
- The same user can also have a clan whitelist with 1 slot

Each saved identifier uses one slot (Steam64 = 1, EOSID = 1).

## Troubleshooting

### Setup commands do not appear
- Make sure `GUILD_ID` is correct
- Restart the bot after replacing `bot.py`
- Give Discord 10-30 seconds to refresh guild commands

### Web server not accessible
- Check `WEB_ENABLED=true` in `.env`
- Check firewall rules for the configured port
- For SSL issues, verify cert and key file paths

### GitHub does not update
- Confirm token has content write access
- Confirm repo owner and repo name are correct

### Bot starts but does nothing
- Run `/status` to check configuration
- Verify subscription and/or clan whitelist is enabled
- Verify role mappings exist and panel channels are configured

## Notes

- DB-first architecture — GitHub and web server are publishing outputs
- Squad permissions are seeded automatically and can be updated if the game adds new ones
- The web server cache is updated in-memory on every sync (no DB hit per HTTP request)
