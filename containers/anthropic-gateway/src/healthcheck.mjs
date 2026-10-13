import http from 'node:http'

const req = http.get({ host: '127.0.0.1', port: Number(process.env.GATEWAY_PORT ?? 8080), path: '/healthz', timeout: 2000 }, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1)
})
req.on('error', () => process.exit(1))
req.on('timeout', () => process.exit(1))
