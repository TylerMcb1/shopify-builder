// Anthropic gateway (README 6.4). Holds the API key in memory only and forwards
// model requests to the Anthropic API over TLS. Not a general proxy.
import http from 'node:http'
import https from 'node:https'
import { receiveSecret } from './handoff.mjs'
import { UPSTREAM_HOST, buildUpstreamHeaders, checkRequest } from './policy.mjs'

const PORT = Number(process.env.GATEWAY_PORT ?? 8080)
const UPSTREAM_PORT = Number(process.env.GATEWAY_UPSTREAM_PORT ?? 443)
const UPSTREAM_PROTOCOL = process.env.GATEWAY_UPSTREAM_PROTOCOL ?? 'https' // overridable for tests only
const UPSTREAM_TARGET = process.env.GATEWAY_UPSTREAM_HOST ?? UPSTREAM_HOST

// Structured logs: path and reason only, never headers or bodies.
const log = (event) => process.stderr.write(JSON.stringify({ source: 'anthropic-gateway', ...event }) + '\n')

let apiKey = null

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(apiKey ? 200 : 503).end()
    return
  }
  const verdict = checkRequest(req.method, req.url)
  if (!verdict.ok) {
    log({ event: 'refused', reason: verdict.reason, path: verdict.path })
    res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":"forbidden"}')
    req.resume()
    return
  }
  if (!apiKey) {
    res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"not ready"}')
    req.resume()
    return
  }
  const transport = UPSTREAM_PROTOCOL === 'https' ? https : http
  const upstream = transport.request(
    { host: UPSTREAM_TARGET, port: UPSTREAM_PORT, method: req.method, path: verdict.path, headers: buildUpstreamHeaders(req.headers, apiKey) },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    log({ event: 'upstream-error', path: verdict.path })
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end('{"error":"upstream unreachable"}')
  })
  req.pipe(upstream)
})

try {
  apiKey = await receiveSecret(process.stdin, process.stdout)
} catch (err) {
  log({ event: 'handoff-failed', reason: err.message })
  process.exit(1)
}
server.listen(PORT, '0.0.0.0', () => log({ event: 'ready', port: PORT }))
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)))
