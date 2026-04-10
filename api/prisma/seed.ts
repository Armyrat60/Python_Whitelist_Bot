/**
 * Local development seed script.
 *
 * Run: npx tsx prisma/seed.ts
 * Or:  npm run db:seed (after adding to package.json)
 *
 * Creates realistic test data for a sample guild:
 * - 1 guild with settings
 * - 2 whitelists (VIP + Clan)
 * - 3 squad groups
 * - 2 panels
 * - 4 panel roles
 * - 20 whitelist users across both whitelists
 * - Identifiers (Steam IDs)
 * - Audit log entries
 * - Seeding data (config + points)
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const GUILD_ID = 123456789012345678n
const OWNER_ID = 100000000000000001n

// Realistic player names
const PLAYERS = [
  { id: 100000000000000001n, name: "CommanderAce",  steam: "76561198000000001" },
  { id: 100000000000000002n, name: "SniperWolf",    steam: "76561198000000002" },
  { id: 100000000000000003n, name: "TankBuster",    steam: "76561198000000003" },
  { id: 100000000000000004n, name: "MedicMain",     steam: "76561198000000004" },
  { id: 100000000000000005n, name: "SquadLead_Fox", steam: "76561198000000005" },
  { id: 100000000000000006n, name: "Grenadier42",   steam: "76561198000000006" },
  { id: 100000000000000007n, name: "ReconShadow",   steam: "76561198000000007" },
  { id: 100000000000000008n, name: "EngineerBob",   steam: "76561198000000008" },
  { id: 100000000000000009n, name: "PilotJones",    steam: "76561198000000009" },
  { id: 100000000000000010n, name: "HAT_Specialist", steam: "76561198000000010" },
  { id: 100000000000000011n, name: "MarksmaN",      steam: "76561198000000011" },
  { id: 100000000000000012n, name: "CombatMedic",   steam: "76561198000000012" },
  { id: 100000000000000013n, name: "MortarKing",    steam: "76561198000000013" },
  { id: 100000000000000014n, name: "Logistics_Pro", steam: "76561198000000014" },
  { id: 100000000000000015n, name: "IFV_Driver",    steam: "76561198000000015" },
  { id: 100000000000000016n, name: "ScoutRecon",    steam: "76561198000000016" },
  { id: 100000000000000017n, name: "SapperDan",     steam: "76561198000000017" },
  { id: 100000000000000018n, name: "AutoRifle",     steam: "76561198000000018" },
  { id: 100000000000000019n, name: "MachineGnr",    steam: "76561198000000019" },
  { id: 100000000000000020n, name: "RadioOp",       steam: "76561198000000020" },
]

async function main() {
  console.log("Seeding development database...")

  const now = new Date()
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000)

  // ── Settings ──
  const settings = [
    { settingKey: "accent_primary", settingValue: "#10b981" },
    { settingKey: "timezone", settingValue: "America/New_York" },
    { settingKey: "auto_reactivate_on_role_return", settingValue: "true" },
    { settingKey: "duplicate_output_dedupe", settingValue: "true" },
    { settingKey: "role_sync_interval_hours", settingValue: "24" },
  ]
  for (const s of settings) {
    await prisma.botSetting.upsert({
      where: { guildId_settingKey: { guildId: GUILD_ID, settingKey: s.settingKey } },
      create: { guildId: GUILD_ID, ...s },
      update: s,
    })
  }
  console.log("  Settings: %d", settings.length)

  // ── Squad Groups ──
  const groups = [
    { groupName: "Reserve", permissions: "reserve" },
    { groupName: "VIP", permissions: "reserve,balance,teamchange" },
    { groupName: "Admin", permissions: "reserve,balance,teamchange,cameraman" },
  ]
  for (const g of groups) {
    await prisma.squadGroup.upsert({
      where: { guildId_groupName: { guildId: GUILD_ID, groupName: g.groupName } },
      create: { guildId: GUILD_ID, ...g, enabled: true },
      update: g,
    })
  }
  console.log("  Groups: %d", groups.length)

  // ── Whitelists ──
  const vipWl = await prisma.whitelist.upsert({
    where: { guildId_slug: { guildId: GUILD_ID, slug: "vip" } },
    create: {
      guildId: GUILD_ID, slug: "vip", name: "VIP Whitelist",
      enabled: true, isDefault: true, squadGroup: "VIP",
      defaultSlotLimit: 2, outputFilename: "whitelist-vip.txt",
    },
    update: {},
  })

  const clanWl = await prisma.whitelist.upsert({
    where: { guildId_slug: { guildId: GUILD_ID, slug: "clan" } },
    create: {
      guildId: GUILD_ID, slug: "clan", name: "Clan Whitelist",
      enabled: true, isDefault: false, squadGroup: "Reserve",
      defaultSlotLimit: 1, outputFilename: "whitelist-clan.txt",
    },
    update: {},
  })
  console.log("  Whitelists: 2 (VIP + Clan)")

  // ── Panels ──
  const vipPanel = await prisma.panel.upsert({
    where: { id: 1 },
    create: {
      guildId: GUILD_ID, name: "VIP Panel", whitelistId: vipWl.id,
      enabled: true,
    },
    update: {},
  })
  console.log("  Panels: 1")

  // ── Users + Identifiers ──
  for (let i = 0; i < PLAYERS.length; i++) {
    const p = PLAYERS[i]
    const wlId = i < 12 ? vipWl.id : clanWl.id
    const status = i < 18 ? "active" : "disabled_role_lost"
    const createdDaysAgo = Math.floor(Math.random() * 180) + 10

    await prisma.whitelistUser.upsert({
      where: { guildId_discordId_whitelistId: { guildId: GUILD_ID, discordId: p.id, whitelistId: wlId } },
      create: {
        guildId: GUILD_ID, discordId: p.id, whitelistId: wlId,
        discordName: p.name, status,
        effectiveSlotLimit: i < 5 ? 3 : 1,
        createdAt: daysAgo(createdDaysAgo), updatedAt: now,
        createdVia: "role_sync",
        roleGainedAt: daysAgo(createdDaysAgo),
      },
      update: { discordName: p.name, status },
    })

    await prisma.whitelistIdentifier.upsert({
      where: { guildId_whitelistId_discordId_idType_idValue: {
        guildId: GUILD_ID, whitelistId: wlId, discordId: p.id,
        idType: "steam64", idValue: p.steam,
      }},
      create: {
        guildId: GUILD_ID, whitelistId: wlId, discordId: p.id,
        idType: "steam64", idValue: p.steam,
      },
      update: {},
    })
  }
  console.log("  Users: %d", PLAYERS.length)

  // ── Audit Log ──
  const actions = ["user_added", "user_removed", "role_sync", "panel_push", "whitelist_updated"]
  for (let i = 0; i < 30; i++) {
    const action = actions[i % actions.length]
    const p = PLAYERS[i % PLAYERS.length]
    await prisma.auditLog.create({
      data: {
        guildId: GUILD_ID,
        actionType: action,
        actorDiscordId: OWNER_ID,
        targetDiscordId: p.id,
        details: `${action.replace(/_/g, " ")} — ${p.name}`,
        createdAt: daysAgo(Math.floor(Math.random() * 30)),
        whitelistId: i < 15 ? vipWl.id : clanWl.id,
      },
    })
  }
  console.log("  Audit log: 30 entries")

  // ── Seeding Points ──
  for (let i = 0; i < 10; i++) {
    const p = PLAYERS[i]
    const points = Math.floor(Math.random() * 300) + 30
    await prisma.seedingPoints.upsert({
      where: { guildId_steamId: { guildId: GUILD_ID, steamId: p.steam } },
      create: {
        guildId: GUILD_ID, steamId: p.steam,
        playerName: p.name, points,
        rewarded: points >= 120,
        currentStreak: Math.floor(Math.random() * 7),
        lastAwardAt: daysAgo(Math.floor(Math.random() * 5)),
      },
      update: { playerName: p.name, points },
    })
  }
  console.log("  Seeding points: 10 players")

  console.log("\nDone! Guild ID: %s", GUILD_ID.toString())
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
