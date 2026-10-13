import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShopifyRunArgs } from '../../src/docker/run-args.ts'

const base = { image: 'img@sha256:abc', network: 'bridge', containerName: 'sb-shopify-1' }

test('applies the same hardening as compose.yaml', () => {
  const args = buildShopifyRunArgs({ ...base, cliArgs: ['theme', 'list', '--json'] })
  const has = (flag: string, value?: string) => {
    const i = args.indexOf(flag)
    return i !== -1 && (value === undefined || args[i + 1] === value)
  }
  assert.ok(has('--rm') && has('-i') && has('--read-only'))
  assert.ok(has('--user', '10001:10001'))
  assert.ok(has('--cap-drop', 'ALL'))
  assert.ok(has('--security-opt', 'no-new-privileges:true'))
  assert.ok(has('--pids-limit', '256') && has('--memory', '1g') && has('--cpus', '1'))
  assert.ok(has('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m'))
  assert.ok(has('--pull', 'never') && has('--log-driver', 'none'))
  assert.ok(!args.includes('-e') && !args.includes('--env') && !args.includes('-v'))
  assert.ok(!args.includes('/var/run/docker.sock'))
  assert.deepEqual(args.slice(-4), ['img@sha256:abc', 'theme', 'list', '--json'])
})

test('mounts only the inbox, and only when given', () => {
  assert.ok(!buildShopifyRunArgs({ ...base, cliArgs: [] }).includes('--mount'))
  const args = buildShopifyRunArgs({ ...base, inboxHostPath: '/data/stores/s/themes/1/inbox', cliArgs: [] })
  assert.equal(args[args.indexOf('--mount') + 1], 'type=bind,source=/data/stores/s/themes/1/inbox,target=/inbox')
})

test('rejects mount paths that could inject options, and bad names', () => {
  for (const p of ['relative/inbox', '/a,readonly=false', '/a"b', '/a\nb', '/a=b']) {
    assert.throws(() => buildShopifyRunArgs({ ...base, inboxHostPath: p, cliArgs: [] }), p)
  }
  assert.throws(() => buildShopifyRunArgs({ ...base, containerName: '--privileged', cliArgs: [] }))
})
