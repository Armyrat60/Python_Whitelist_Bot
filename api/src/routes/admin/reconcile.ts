/**
 * Reconciliation routes (stub — complex matching logic).
 * These stubs let the frontend load without 404s while full logic is pending.
 */
import type { FastifyInstance } from "fastify"

export default async function reconcileRoutes(app: FastifyInstance) {
  const adminHook = [app.requireAdmin]

  app.post("/reconcile/preview", { preHandler: adminHook }, async (_req, reply) => {
    return reply.code(501).send({ error: "Reconcile preview not yet implemented in TypeScript API." })
  })

  app.post("/reconcile/apply", { preHandler: adminHook }, async (_req, reply) => {
    return reply.code(501).send({ error: "Reconcile apply not yet implemented in TypeScript API." })
  })

  app.post("/reconcile/rematch-orphans", { preHandler: adminHook }, async (_req, reply) => {
    return reply.code(501).send({ error: "Reconcile rematch not yet implemented in TypeScript API." })
  })

  app.get("/reconcile/suggest", { preHandler: adminHook }, async (_req, reply) => {
    return reply.code(501).send({ error: "Reconcile suggest not yet implemented in TypeScript API." })
  })
}
