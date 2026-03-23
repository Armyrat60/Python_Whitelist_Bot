
# Squad Whitelist Bot

Discord bot for managing Squad whitelist entries with MariaDB/MySQL and GitHub publishing.

## What it does

- Stores whitelist ownership per Discord user
- Supports **Subscription** and **Clan** whitelist types
- Supports **Steam64** and **EOSID**
- Tracks slot limits by role mapping, with optional moderator override
- Automatically disables whitelist output when a user loses the required role
- Automatically removes users from active output when they leave the Discord
- Publishes whitelist files to GitHub for Squad Remote Admin raw-link use
- Keeps audit history and weekly or daily reports

## Main features

- Interactive `/setup` wizard
- Separate enable/disable for subscription and clan whitelists
- Output modes:
  - `combined`
  - `separate`
  - `hybrid`
- Per-type panel and log channels
- Per-type GitHub filenames
- Moderator tools
- Duplicate output dedupe before GitHub publish
- 90-day retention by default

## Requirements

- Python 3.10+
- MariaDB or MySQL
- Discord bot token
- GitHub personal access token with repo content write access

## Installation

1. Upload these files:
   - `bot.py`
   - `.env`
   - `requirements.txt`

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

## Recommended requirements.txt

```txt
discord.py
aiomysql
python-dotenv
PyGithub
PyMySQL
```

## Environment file

Only secrets and bootstrap settings stay in `.env`.

Required:
- `DISCORD_TOKEN`
- `GUILD_ID`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `GITHUB_TOKEN`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `WHITELIST_FILENAME`

Optional:
- `BOOTSTRAP_MOD_ROLE_ID`

## First-time setup

1. Start the bot
2. Run:
   - `/setup_mod_role`
3. Run:
   - `/setup`
4. Use the setup wizard buttons to configure:
   - global output
   - subscription settings
   - clan settings
   - role mappings
5. Set channels with:
   - `/setup_channels`
6. Post the panel:
   - `/whitelist_panel`

## Commands

### Basic
- `/ping`
- `/help`
- `/status`

### Setup
- `/setup`
- `/setup_mod_role`
- `/setup_channels`
- `/setup_rolemap_remove`
- `/setup_status`

### User
- `/whitelist`
- `/my_whitelist`

### Moderator
- `/whitelist_panel`
- `/resync_whitelist`
- `/mod_view`
- `/mod_set`
- `/mod_remove`
- `/mod_override`
- `/report_now`

## How slot ownership works

Slot limits are tracked **per Discord user, per whitelist type**.

Example:
- A user can have a subscription whitelist with 4 slots
- The same user can also have a clan whitelist with 1 slot

Each saved identifier uses one slot:
- Steam64 = 1 slot
- EOSID = 1 slot

## Duplicate handling

- Duplicate IDs inside one submission are automatically deduped
- Duplicate IDs across different users are **allowed**
- The final GitHub output is **deduped before publish** to reduce duplicate entries in the final file

## GitHub publishing

The bot publishes Squad Remote Admin text files to GitHub.

Supported output modes:

- `combined`
  - one combined file
- `separate`
  - one subscription file
  - one clan file
- `hybrid`
  - combined file plus both separate files

## Troubleshooting

### Setup commands do not appear
- Make sure `GUILD_ID` is correct
- Restart the bot after replacing `bot.py`
- Give Discord 10–30 seconds to refresh guild commands

### Channels do not appear in `/setup_channels`
- Make sure the bot can see those channels
- Check category permissions
- Check channel-specific overrides
- The bot needs:
  - View Channel
  - Send Messages
  - Read Message History

### GitHub does not update
- Confirm token has content write access
- Confirm repo owner and repo name are correct
- Confirm filenames match what you expect

### Bot starts but does nothing
- Check `/setup_status`
- Verify subscription and/or clan whitelist is enabled
- Verify role mappings exist
- Verify panel channels and log channels are configured

### User cannot submit IDs
- Verify whitelist type is enabled
- Verify they have a mapped role or a default slot limit
- Verify the panel exists in the correct channel

### EOSID validation
- This build validates EOSID format only
- EOSIDs are stored as unverified unless you add external verification later

## Notes

- This bot is DB-first
- GitHub is used for publishing only
- Google Sheets is not used by this version
