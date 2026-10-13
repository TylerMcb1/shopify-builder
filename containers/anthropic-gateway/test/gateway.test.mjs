import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import sodium from 'libsodium-wrappers'
import { checkRequest, buildUpstreamHeaders } from '../src/policy.mjs'

test('policy allows only model-request paths', () => {
  assert.equal(checkRequest('POST', '/v1/messages?beta=true').ok, true)
  assert.equal(checkRequest('POST', '/v1/messages/count_tokens').ok, true)
  for (const [m, p] of [['GET', '/v1/messages'], ['POST', '/v1/files'], ['POST', '/'], ['POST', '//evil.com/v1/messages']]) {
    assert.equal(checkRequest(m, p).ok, false, `${m} ${p}`)
  }
})

test('policy swaps credentials and drops unknown headers', () => {
  const h = buildUpstreamHeaders({ 'x-api-key': 'placeholder', authorization: 'Bearer x', cookie: 'c', 'anthropic-version': '2023-06-01' }, 'REAL')
  assert.equal(h['x-api-key'], 'REAL')
  assert.equal(h.authorization, undefined)
  assert.equal(h.cookie, undefined)
  assert.equal(h['anthropic-version'], '2023-06-01')
})

test('end to end: encrypted handoff, key injection, refusal', async () => {
  await sodium.ready
  let seen
  const upstream = http.createServer((req, res) => {
    seen = { key: req.headers['x-api-key'], auth: req.headers.authorization, path: req.url }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))

  const child = spawn('node', ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, GATEWAY_PORT: '18080', GATEWAY_UPSTREAM_PROTOCOL: 'http', GATEWAY_UPSTREAM_HOST: '127.0.0.1', GATEWAY_UPSTREAM_PORT: String(upstream.address().port) },
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  try {
    const pub = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(d.toString().trim())))
    const sealed = sodium.crypto_box_seal('sk-ant-test-secret', sodium.from_base64(pub, sodium.base64_variants.ORIGINAL))
    const ct = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL)
    assert.ok(!ct.includes('sk-ant'))
    child.stdin.end(ct + '\n')
    for (let i = 0; i < 50 && !stderr.includes('ready'); i++) await new Promise((r) => setTimeout(r, 100))
    assert.ok(stderr.includes('ready'), stderr)

    const call = (method, path) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: 18080, method, path, headers: { 'x-api-key': 'placeholder', authorization: 'Bearer agent' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
      req.on('error', reject).end('{}')
    })
    assert.equal(await call('POST', '/v1/messages'), 200)
    assert.deepEqual(seen, { key: 'sk-ant-test-secret', auth: undefined, path: '/v1/messages' })
    assert.equal(await call('GET', '/v1/organizations'), 403)
    assert.ok(stderr.includes('path-not-allowed'))
    assert.ok(!stderr.includes('sk-ant-test-secret'))
  } finally {
    child.kill()
    upstream.close()
  }
})
