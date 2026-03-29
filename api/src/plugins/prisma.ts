import fp from "fastify-plugin"
import { PrismaClient } from "@prisma/client"
import type { FastifyPluginAsync, FastifyInstance } from "fastify"

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

const prismaPlugin: FastifyPluginAsync = fp(async (app: FastifyInstance) => {
  const prisma = new PrismaClient({
    log: app.log.level === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
  })
  await prisma.$connect()
  app.decorate("prisma", prisma)
  app.addHook("onClose", async () => {
    await prisma.$disconnect()
  })
})

export default prismaPlugin
