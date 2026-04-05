/**
 * Shared JSON helpers for BigInt serialization.
 *
 * Prisma returns BigInt for certain ID columns. JSON.stringify() throws on
 * BigInt values, so we convert them to strings before serializing.
 */

export function bigIntReplacer(_: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

export function toJSON(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data, bigIntReplacer));
}
