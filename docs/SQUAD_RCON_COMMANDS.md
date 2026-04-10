# Squad RCON Commands Reference

Complete list of Squad dedicated server RCON commands with risk classification.

## Read-Only Commands (Safe)

| Command | Description |
|---------|-------------|
| `ListPlayers` | List all online players (ID, SteamID, Name, Team, Squad) |
| `ListSquads` | List all squads (ID, Name, Team, Size, Leader) |
| `ShowCurrentMap` | Show current map/layer name |
| `ShowNextMap` | Show next map in rotation |
| `ShowServerInfo` | Server name, player count, map, etc. |
| `AdminListDisconnectedPlayers` | Recently disconnected players |

## Player Management Commands

| Command | Syntax | Description |
|---------|--------|-------------|
| `AdminWarn` | `AdminWarn <NameOrSteamId> <Message>` | Send in-game warning message to player |
| `AdminKick` | `AdminKick <NameOrSteamId> <Reason>` | Kick player (can rejoin immediately) |
| `AdminKickById` | `AdminKickById <PlayerId> <Reason>` | Kick by in-game player ID |
| `AdminBan` | `AdminBan <NameOrSteamId> <Length> <Reason>` | Ban player (length in minutes, 0=permanent) |
| `AdminBanById` | `AdminBanById <PlayerId> <Length> <Reason>` | Ban by in-game player ID |
| `AdminForceTeamChange` | `AdminForceTeamChange <NameOrSteamId>` | Move player to opposite team |
| `AdminRemoveFromSquad` | `AdminRemoveFromSquad <NameOrSteamId>` | Remove player from their squad |
| `AdminDisbandSquad` | `AdminDisbandSquad <TeamId> <SquadId>` | Disband a specific squad |
| `AdminDemoteCommander` | `AdminDemoteCommander <TeamId>` | Remove commander from team |

## Server Communication

| Command | Syntax | Description |
|---------|--------|-------------|
| `AdminBroadcast` | `AdminBroadcast <Message>` | Send message to ALL players on screen |
| `ChatToAdmin` | `ChatToAdmin <Message>` | Send message to admin chat |

## Match & Map Control

| Command | Syntax | Description |
|---------|--------|-------------|
| `AdminChangeMap` | `AdminChangeMap <MapName>` | Force immediate map change (ends current match!) |
| `AdminSetNextMap` | `AdminSetNextMap <MapName>` | Set the next map in rotation |
| `AdminEndMatch` | `AdminEndMatch` | End the current match immediately |
| `AdminRestartMatch` | `AdminRestartMatch` | Restart the current match |
| `AdminPauseMatch` | `AdminPauseMatch` | Pause the match |
| `AdminUnpauseMatch` | `AdminUnpauseMatch` | Resume paused match |

## Server Configuration

| Command | Syntax | Description |
|---------|--------|-------------|
| `AdminSetMaxNumPlayers` | `AdminSetMaxNumPlayers <Num>` | Change max player count |
| `AdminSetNumReservedSlots` | `AdminSetNumReservedSlots <Num>` | Change reserved slot count |
| `AdminSetServerPassword` | `AdminSetServerPassword <Password>` | Set/clear server password |
| `AdminSlomo` | `AdminSlomo <Rate>` | Change game speed (1.0 = normal) |

## Dangerous / Destructive

| Command | Syntax | Description |
|---------|--------|-------------|
| `AdminKillServer` | `AdminKillServer <Force 0\|1>` | **KILL THE SERVER PROCESS** |

## Utility

| Command | Syntax | Description |
|---------|--------|-------------|
| `AdminAddCameraman` | `AdminAddCameraman <NameOrId>` | Add spectator camera for player |
| `AdminDemoRec` | `AdminDemoRec <FileName>` | Start recording a demo |
| `AdminDemoStop` | `AdminDemoStop` | Stop recording |

---

## Dashboard Permission Mapping

The Squad Whitelister dashboard uses granular permissions to control which
RCON commands users can execute:

| Permission Flag | Commands Allowed |
|----------------|-----------------|
| `rcon_read` | ListPlayers, ListSquads, ShowCurrentMap, ShowNextMap, ShowServerInfo |
| `rcon_execute` | AdminWarn, AdminKick, AdminBroadcast, AdminForceTeamChange, AdminRemoveFromSquad, AdminDisbandSquad |

### Blocked Commands (not exposed in dashboard)

These commands are intentionally **NOT available** through the dashboard:

- `AdminBan` — Use BattleMetrics bans instead (easier to track, manage, appeal)
- `AdminKillServer` — Too dangerous for remote execution
- `AdminChangeMap` / `AdminEndMatch` / `AdminRestartMatch` — Disrupts all players
- `AdminSetServerPassword` — Could lock out the entire server
- `AdminSlomo` — Breaks gameplay

### Why BattleMetrics Bans Over RCON Bans

1. **Tracking**: BM bans have full audit trails, notes, expiry management
2. **Cross-server**: BM bans can apply across multiple servers
3. **Appeals**: BM has built-in appeal workflows
4. **Visibility**: BM ban lists are searchable and filterable
5. **RCON bans are fire-and-forget**: No easy way to list, search, or manage them

Squad RCON `AdminBan` should only be used as an emergency fallback when
BattleMetrics is unavailable.

---

## Sources

- [Squad Wiki - Server Administration](https://squad.fandom.com/wiki/Server_Administration)
- [Squad RCON PHP Library](https://github.com/SquadSlovenia/squad-rcon-php)
- [Loafhosts Squad Server Commands Guide](https://loafhosts.com/guides/squad/squad-server-commands/)
