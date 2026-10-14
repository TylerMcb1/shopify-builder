import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { HostError } from '../../src/errors.ts'
import { CHANGE_MESSAGES } from '../../src/change/messages.ts'
import { openRecords, type Records } from '../../src/records/store.ts'
import { createWriteGateway, parsePushResult } from '../../src/shopify/gateway.ts'
import { buildThemePushArgs, writeAllowed } from '../../src/shopify/push.ts'
import { createShopifyRunner } from '../../src/shopify/runner.ts'
import { type Theme } from '../../src/shopify/schemas.ts'
import { FAKE_DOCKER, TEST_IMAGE, TEST_TOKEN, tempDir } from '../helpers.ts'

const domain = 'example.myshopify.com'
const working: Theme = { id: 222, name: 'Working', role: 'unpublished' }
const live: Theme = { id: 111, name: 'Dawn', role: 'live' }

function gateway(records: Records, themes: Theme[], pushes: string[][]) {
  return createWriteGateway({
    storeId: 'store-1',
    storeDomain: domain,
    records,
    listThemes: async () => themes,
    runPush: async (args) => {
      pushes.push([...args])
      const id = args.includes('--development') || args.includes('--unpublished') ? 444 : Number(args[args.indexOf('--theme') + 1])
      const name = args.includes('--unpublished') ? args[args.indexOf('--theme') + 1]! : 'Working'
      const role = args.includes('--development') ? 'development' : 'unpublished'
      return JSON.stringify({ theme: { id, name, role }, preview_url: 'https://evil.example/preview' })
    },
  })
}

test('push arguments are nodelete, never live, and list only the changed files', () => {
  const files = buildThemePushArgs({ kind: 'files', storeDomain: domain, themeId: 222, only: ['sections/hero.liquid'] })
  assert.ok(files.includes('--nodelete'))
  assert.deepEqual(files.filter((_, index) => files[index - 1] === '--only'), ['sections/hero.liquid'])
  assert.equal(files.includes('--allow-live'), false)
  assert.equal(files.includes('--publish'), false)
  assert.equal(files.includes('--delete'), false)
  const mirror = buildThemePushArgs({ kind: 'mirror', storeDomain: domain, themeId: 333 })
  assert.equal(mirror.includes('--only'), false)
  assert.ok(buildThemePushArgs({ kind: 'create-unpublished', storeDomain: domain, themeName: '[Builder] Working copy' }).includes('--unpublished'))
  assert.equal(buildThemePushArgs({ kind: 'create-development', storeDomain: domain }).includes('--theme'), false)
  assert.throws(() => buildThemePushArgs({ kind: 'files', storeDomain: domain, themeId: 222, only: [] }))
  assert.throws(() => buildThemePushArgs({ kind: 'files', storeDomain: domain, themeId: 222, only: ['../secrets'] }))
})

test('only an unpublished theme this app manages can be saved, and preview themes stay development or unpublished', () => {
  const owned = { storeId: 'store-1', themeId: 222, kind: 'working-copy' as const, name: 'Working', originThemeId: 111, retired: false }
  assert.equal(writeAllowed(working, owned, 'save'), true)
  assert.equal(writeAllowed({ ...working, role: 'live' }, owned, 'save'), false)
  assert.equal(writeAllowed(working, { ...owned, kind: 'preview' }, 'save'), false)
  assert.equal(writeAllowed(working, { ...owned, retired: true }, 'save'), false)
  const preview = { ...owned, themeId: 333, kind: 'preview' as const }
  assert.equal(writeAllowed({ id: 333, name: 'Preview', role: 'development' }, preview, 'preview'), true)
  assert.equal(writeAllowed({ id: 333, name: 'Preview', role: 'live' }, preview, 'preview'), false)
})

test('a save push is refused when the theme is live or unowned, and a role change stops further saves', async () => {
  const { dir, cleanup } = tempDir('sb-gateway-')
  try {
    const records = openRecords(dir)
    const pushes: string[][] = []
    records.saveOwnership({ storeId: 'store-1', themeId: 111, kind: 'working-copy', name: 'Dawn', originThemeId: null, retired: false })
    const denied = gateway(records, [live], pushes)
    await assert.rejects(denied.pushSavedFiles(111, dir, ['sections/hero.liquid']), (err: unknown) => {
      return err instanceof HostError && err.userMessage === CHANGE_MESSAGES.notWritable
    })
    assert.equal(pushes.length, 0)

    const flipped: Theme[] = [{ ...working }]
    const writer = createWriteGateway({
      storeId: 'store-1',
      storeDomain: domain,
      records,
      listThemes: async () => {
        const theme = flipped[0]!
        flipped[0] = { ...theme, role: 'live' }
        return [theme]
      },
      runPush: async (args) => {
        pushes.push([...args])
        return JSON.stringify({ theme: working })
      },
    })
    records.saveOwnership({ storeId: 'store-1', themeId: 222, kind: 'working-copy', name: 'Working', originThemeId: null, retired: false })
    await assert.rejects(writer.pushSavedFiles(222, dir, ['sections/hero.liquid']), (err: unknown) => {
      return err instanceof HostError && err.userMessage.startsWith(CHANGE_MESSAGES.roleChanged)
    })
    assert.equal(records.getOwnership('store-1', 222)?.retired, true)
    assert.equal(pushes.length, 1)
    assert.ok(pushes[0]?.includes('--nodelete'))
  } finally {
    cleanup()
  }
})

test('parsePushResult keeps the theme and drops preview urls from the CLI', () => {
  const theme = parsePushResult('{"theme":{"id":5,"name":"Working","role":"unpublished","preview_url":"https://evil.example"}}')
  assert.deepEqual(theme, { id: 5, name: 'Working', role: 'unpublished' })
  assert.equal('preview_url' in theme, false)
})

test('a real push command is accepted by the container policy and returns the theme without its preview url', async () => {
  const { dir, cleanup } = tempDir('sb-gateway-docker-')
  const themeDir = path.join(dir, 'theme')
  mkdirSync(themeDir, { recursive: true })
  const records = openRecords(dir)
  records.saveOwnership({ storeId: 'store-1', themeId: 222, kind: 'working-copy', name: 'Working', originThemeId: null, retired: false })
  const runner = createShopifyRunner({
    image: TEST_IMAGE,
    getThemeToken: async () => TEST_TOKEN,
    dockerCommand: FAKE_DOCKER,
    dockerEnv: { ...process.env, FAKE_DOCKER_IMAGE: TEST_IMAGE, FAKE_EXPECT_TOKEN: TEST_TOKEN },
  })
  const writer = createWriteGateway({
    storeId: 'store-1',
    storeDomain: domain,
    records,
    listThemes: async () => [working, { id: 444, name: 'Working', role: 'development' }],
    runPush: (args, tree) => runner.push(args, tree),
  })
  try {
    const theme = await writer.pushSavedFiles(222, themeDir, ['sections/hero.liquid'])
    assert.deepEqual(theme, working)
    const preview = await writer.createPreview(themeDir, 'development')
    assert.equal(preview.role, 'development')
    assert.equal(records.getPreview('store-1')?.themeId, preview.id)
  } finally {
    cleanup()
  }
})
