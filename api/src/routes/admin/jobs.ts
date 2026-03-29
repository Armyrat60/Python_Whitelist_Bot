/**
 * Job queue routes.
 *
 * GET  /jobs/:id       — poll status of a background job
 * GET  /jobs           — list recent jobs for this guild (optional ?type=bridge_sync)
 */
import type { FastifyInstance } from "fastify"

export default async function jobRoutes(app: FastifyInstance) {
  const adminHook = [app.requireAdmin]

  // ── GET /jobs/:id ────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/jobs/:id",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const id      = parseInt(req.params.id, 10)
      if (isNaN(id)) return reply.code(400).send({ error: "Invalid job id" })

      const job = await app.prisma.jobQueue.findUnique({ where: { id } })
      if (!job || job.guildId !== guildId) {
        return reply.code(404).send({ error: "Job not found" })
      }

      return reply.send({ job: serializeJob(job) })
    }
  )

  // ── GET /jobs ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { type?: string; limit?: string } }>(
    "/jobs",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId  = BigInt(req.session.activeGuildId!)
      const jobType  = req.query.type
      const limit    = Math.min(parseInt(req.query.limit ?? "20", 10) || 20, 100)

      const jobs = await app.prisma.jobQueue.findMany({
        where: {
          guildId,
          ...(jobType ? { jobType } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      })

      return reply.send({ jobs: jobs.map(serializeJob) })
    }
  )
}

function serializeJob(job: {
  id: number
  guildId: bigint
  jobType: string
  payload: unknown
  status: string
  priority: number
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
  result: unknown
  error: string | null
}) {
  return {
    id:           job.id,
    job_type:     job.jobType,
    status:       job.status,
    priority:     job.priority,
    created_at:   job.createdAt.toISOString(),
    started_at:   job.startedAt?.toISOString() ?? null,
    completed_at: job.completedAt?.toISOString() ?? null,
    result:       job.result ?? null,
    error:        job.error ?? null,
  }
}
