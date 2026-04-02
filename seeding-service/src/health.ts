/**
 * Minimal HTTP health check server.
 *
 * Railway uses this to determine if the service is alive.
 * GET /healthz → { status: "ok", guilds: N, connections: M }
 */

import http from "node:http"

let _server: http.Server | null = null
let _guildCount = 0
let _connectionCount = 0

export function updateHealthStats(guilds: number, connections: number) {
  _guildCount = guilds
  _connectionCount = connections
}

export function startHealthServer(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    _server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({
          status: "ok",
          service: "seeding-service",
          guilds: _guildCount,
          connections: _connectionCount,
          uptime: Math.floor(process.uptime()),
        }))
        return
      }

      res.writeHead(404)
      res.end("Not Found")
    })

    _server.listen(port, "::", () => {
      console.log(`[seeding/health] Health server listening on port ${port}`)
      resolve()
    })

    _server.on("error", reject)
  })
}

export function stopHealthServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!_server) return resolve()
    _server.close(() => resolve())
  })
}
