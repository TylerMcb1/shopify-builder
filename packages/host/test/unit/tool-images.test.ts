import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  checkToolImages,
  interpretImageInspect,
  parseToolManifest,
  readToolManifest,
  type ToolManifest,
} from '../../src/docker/images.ts'

const ID_A = `sha256:${'a'.repeat(64)}`
const ID_B = `sha256:${'b'.repeat(64)}`

const manifest: ToolManifest = {
  minimumDockerVersion: '24.0.0',
  images: {
    base: { ref: 'shopify-builder/base:local', id: ID_A },
    agent: { ref: 'shopify-builder/agent:local', id: ID_A },
    shopify: { ref: 'shopify-builder/shopify:local', id: ID_A },
    gateway: { ref: 'shopify-builder/anthropic-gateway:local', id: ID_A },
  },
}

const ids = { base: ID_A, agent: ID_A, shopify: ID_A, gateway: ID_A }

test('a manifest matches only the pinned image ids', () => {
  const ready = interpretImageInspect(manifest, ids)
  assert.equal(ready.ready, true)
  assert.equal(ready.status, 'ready')
  assert.deepEqual(
    ready.images.map((image) => image.status),
    ['match', 'match', 'match', 'match'],
  )

  const missing = interpretImageInspect(manifest, { ...ids, shopify: null })
  assert.equal(missing.status, 'missing')
  assert.equal(missing.images.find((image) => image.name === 'shopify')?.message, 'Not downloaded yet')

  const mismatch = interpretImageInspect(manifest, { ...ids, gateway: ID_B })
  assert.equal(mismatch.status, 'mismatch')
  assert.match(mismatch.message, /doesn't match/i)

  const unpinned = interpretImageInspect(
    {
      ...manifest,
      images: {
        ...manifest.images,
        base: { ref: manifest.images.base.ref, id: null },
        agent: { ref: manifest.images.agent.ref, id: null },
        shopify: { ref: manifest.images.shopify.ref, id: null },
        gateway: { ref: manifest.images.gateway.ref, id: null },
      },
    },
    ids,
  )
  assert.equal(unpinned.ready, false)
  assert.equal(unpinned.status, 'unpinned')
})

test('checkToolImages inspects each ref and ignores non-id output', async () => {
  const calls: string[] = []
  const report = await checkToolImages({
    manifest,
    run: async (args) => {
      const ref = args[args.length - 1] ?? ''
      calls.push(ref)
      assert.deepEqual(args.slice(0, 3), ['image', 'inspect', '--format'])
      if (ref.endsWith('shopify:local')) return { exitCode: 0, stdout: 'not-an-id\n', stderr: '', spawnError: null }
      return { exitCode: 0, stdout: `${ID_A}\n`, stderr: '', spawnError: null }
    },
  })
  assert.deepEqual(calls, [
    manifest.images.base.ref,
    manifest.images.agent.ref,
    manifest.images.shopify.ref,
    manifest.images.gateway.ref,
  ])
  assert.equal(report.images.find((image) => image.name === 'shopify')?.status, 'missing')
})

test('the manifest schema rejects extra fields, bad refs, and bad ids', () => {
  assert.equal(parseToolManifest(manifest).minimumDockerVersion, '24.0.0')
  assert.throws(() => parseToolManifest({ ...manifest, extra: true }))
  assert.throws(() =>
    parseToolManifest({ ...manifest, images: { ...manifest.images, base: { ref: 'not a ref', id: null } } }),
  )
  assert.throws(() =>
    parseToolManifest({
      ...manifest,
      images: { ...manifest.images, agent: { ref: manifest.images.agent.ref, id: 'sha256:abcd' } },
    }),
  )
  assert.throws(() => parseToolManifest({ ...manifest, minimumDockerVersion: 'latest' }))
})

test('readToolManifest reads a pin file from disk', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sb-manifest-'))
  const file = path.join(dir, 'tool-manifest.json')
  writeFileSync(file, JSON.stringify(manifest))
  const read = await readToolManifest(file)
  assert.equal(read.images.gateway.ref, 'shopify-builder/anthropic-gateway:local')
  assert.equal(read.images.gateway.id, ID_A)
})
