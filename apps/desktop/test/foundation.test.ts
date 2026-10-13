import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectSetupStatus } from '../src/main/foundation.ts'
import { DOCKER_MESSAGES, type DockerStatus } from '../../../packages/host/src/docker/status.ts'
import { parseToolManifest, type ToolImageReport } from '../../../packages/host/src/docker/images.ts'

const ready: DockerStatus = { state: 'ready', message: DOCKER_MESSAGES.ready, version: '27.0.0', os: 'linux' }
const down: DockerStatus = { state: 'not-running', message: DOCKER_MESSAGES.open, version: null, os: null }

const imageReport: ToolImageReport = {
  ready: false,
  status: 'unpinned',
  message: 'Tools are downloaded. A release checks the exact version.',
  images: (['base', 'agent', 'shopify', 'gateway'] as const).map((name) => ({
    name,
    ref: `shopify-builder/${name}:local`,
    status: 'unpinned' as const,
    message: 'Downloaded, not locked to a release yet',
  })),
}

test('a stopped Docker Desktop skips image inspection', async () => {
  let inspected = false
  const status = await collectSetupStatus({
    manifestOk: true,
    checkDocker: async () => down,
    checkImages: async () => {
      inspected = true
      return imageReport
    },
  })
  assert.equal(inspected, false)
  assert.equal(status.docker.message, DOCKER_MESSAGES.open)
  assert.equal(status.images.message, 'Tools can be checked once Docker Desktop is ready.')
  assert.equal(status.images.images.length, 4)
})

test('a broken tool list is reported without a filesystem path', async () => {
  const status = await collectSetupStatus({
    manifestOk: false,
    checkDocker: async () => ready,
    checkImages: async () => {
      throw new Error('ENOENT /Users/secret/tool-manifest.json')
    },
  })
  assert.equal(status.images.status, 'invalid-manifest')
  assert.equal(JSON.stringify(status).includes('/Users'), false)
  assert.equal(JSON.stringify(status).includes('ENOENT'), false)
})

test('a ready daemon returns the image report', async () => {
  const status = await collectSetupStatus({
    manifestOk: true,
    checkDocker: async () => ready,
    checkImages: async () => imageReport,
  })
  assert.equal(status.docker.state, 'ready')
  assert.equal(status.images.status, 'unpinned')
  assert.equal(status.images.ready, false)
})

test('the shipped tool manifest names the three images plus the shared base', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../resources/tool-manifest.json')
  const manifest = parseToolManifest(JSON.parse(readFileSync(file, 'utf8')))
  assert.equal(manifest.minimumDockerVersion, '24.0.0')
  assert.equal(manifest.images.base.ref, 'shopify-builder/base:local')
  assert.equal(manifest.images.agent.ref, 'shopify-builder/agent:local')
  assert.equal(manifest.images.shopify.ref, 'shopify-builder/shopify:local')
  assert.equal(manifest.images.gateway.ref, 'shopify-builder/anthropic-gateway:local')
})
