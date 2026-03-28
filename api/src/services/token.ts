/**
 * Whitelist file URL token generation.
 *
 * Tokens are deterministic HMAC-SHA256 of guild identifier + secret,
 * truncated to 16 hex chars. Same guild always gets the same token
 * (stable URLs), but impossible to guess without the secret.
 *
 * Port of generate_file_token() / get_file_token() from bot/web.py.
 */
import { createHmac, timingSafeEqual } from "crypto"
import { env } from "../lib/env.js"

// ─── Token generation ─────────────────────────────────────────────────────────

/** Derive a 16-char hex token from guild identifier + file secret. */
export function generateFileToken(guildIdentifier: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(guildIdentifier)
    .digest("hex")
    .slice(0, 16)
}

/** Get the current token for a guild, incorporating its URL salt if set. */
export function getFileToken(guildId: bigint, salt: string | null): string {
  const secret = resolveFileSecret()
  const identifier = salt ? `${guildId}:${salt}` : String(guildId)
  return generateFileToken(identifier, secret)
}

/** Build the full public URL for a whitelist file. */
export function getFileUrl(guildId: bigint, filename: string, salt: string | null): string {
  const token = getFileToken(guildId, salt)
  const base = env.WEB_BASE_URL || `http://localhost:${env.PORT}`
  return `${base}/wl/${token}/${filename}`
}

/** Constant-time token comparison to prevent timing attacks. */
export function verifyToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

// ─── Secret resolution ────────────────────────────────────────────────────────

let _resolvedSecret: string | null = null

/**
 * Resolve the file secret once.
 * If WEB_FILE_SECRET is not set, derive it from DISCORD_TOKEN (same
 * logic as bot/config.py) so tokens are stable across restarts.
 */
function resolveFileSecret(): string {
  if (_resolvedSecret) return _resolvedSecret
  if (env.WEB_FILE_SECRET) {
    _resolvedSecret = env.WEB_FILE_SECRET
  } else {
    const seed = env.DISCORD_TOKEN || Math.random().toString(36)
    _resolvedSecret = createHmac("sha256", seed)
      .update("wl-file-secret")
      .digest("hex")
  }
  return _resolvedSecret
}
