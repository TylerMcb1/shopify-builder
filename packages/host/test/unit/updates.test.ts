import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { credentialsSurviveUpdate, imageSwitch, updateDecision } from '../../src/updates/policy.ts'
import { buildGatewayConnectArgs, buildGatewayRemoveArgs, buildGatewayRunArgs, GATEWAY_ALIAS } from '../../src/agent/run-args.ts'

test('an update waits for a signature and for the current change to finish', () => {
  assert.equal(updateDecision({ jobRunning: false, downloaded: false, signatureOk: true, current: '0.1.0', minimum: null }).message, "You're up to date.")
  const bad = updateDecision({ jobRunning: false, downloaded: true, signatureOk: false, current: '0.1.0', minimum: null })
  assert.equal(bad.canRestart, false)
  assert.match(bad.message, /signature/)
  const busy = updateDecision({ jobRunning: true, downloaded: true, signatureOk: true, current: '0.1.0', minimum: null })
  assert.equal(busy.canRestart, false)
  assert.match(busy.message, /An update is ready/)
  const ready = updateDecision({ jobRunning: false, downloaded: true, signatureOk: true, current: '0.1.0', minimum: null })
  assert.equal(ready.canRestart, true)
  const blocked = updateDecision({ jobRunning: false, downloaded: false, signatureOk: false, current: '0.1.0', minimum: '0.2.0' })
  assert.equal(blocked.blocked, true)
  const finishing = updateDecision({ jobRunning: true, downloaded: false, signatureOk: false, current: '0.1.0', minimum: '0.2.0' })
  assert.equal(finishing.blocked, false)
})

test('tool images switch only after the new set is verified', () => {
  const previous = { agent: 'sha256:' + 'a'.repeat(64), shopify: 'sha256:' + 'b'.repeat(64) }
  const candidate = { agent: 'sha256:' + 'c'.repeat(64), shopify: 'sha256:' + 'd'.repeat(64) }
  assert.deepEqual(imageSwitch({ previous, candidate, verified: false }), { use: previous, removePrevious: false })
  assert.deepEqual(imageSwitch({ previous, candidate, verified: true }), { use: candidate, removePrevious: true })
})

test('credentials stay in user data across an app update', () => {
  assert.equal(credentialsSurviveUpdate('/Users/me/Library/Application Support/Shopify Builder', '/Applications/Shopify Builder.app'), true)
  assert.equal(credentialsSurviveUpdate('/Applications/Shopify Builder.app/Contents/Resources', '/Applications/Shopify Builder.app'), false)
})

test('the gateway starts without a secret in its arguments and joins the agent network by name', () => {
  const image = 'sha256:' + 'e'.repeat(64)
  const args = buildGatewayRunArgs(image)
  assert.equal(args.includes('-e'), false)
  assert.equal(args.includes('--env'), false)
  assert.equal(args.includes('sk-ant-api03-example'), false)
  assert.equal(args.at(-1), image)
  assert.equal(args.includes('--network') && args.includes('bridge'), true)
  assert.deepEqual(buildGatewayConnectArgs().slice(0, 4), ['network', 'connect', '--alias', GATEWAY_ALIAS])
  assert.deepEqual(buildGatewayRemoveArgs(), ['rm', '-f', 'sb-anthropic-gateway'])
  assert.throws(() => buildGatewayRunArgs('image with spaces'))
  assert.equal(path.basename('sb-anthropic-gateway'), 'sb-anthropic-gateway')
})
