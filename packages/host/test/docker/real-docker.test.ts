// Opt-in: runs the real shopify-builder/shopify image against a real store.
//   SHOPIFY_BUILDER_DOCKER_TESTS=1 SHOPIFY_STORE=x.myshopify.com SHOPIFY_THEME_TOKEN=... [SHOPIFY_THEME_ID=123]
// The token is read from this process's environment for testing only; the app reads it from safeStorage.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createShopifyReadService } from '../../src/index.ts'
import { tempDir } from '../helpers.ts'

const { SHOPIFY_BUILDER_DOCKER_TESTS, SHOPIFY_STORE, SHOPIFY_THEME_TOKEN, SHOPIFY_THEME_ID } = process.env
const enabled = SHOPIFY_BUILDER_DOCKER_TESTS === '1' && !!SHOPIFY_STORE && !!SHOPIFY_THEME_TOKEN
const skip = enabled ? false : 'set SHOPIFY_BUILDER_DOCKER_TESTS=1, SHOPIFY_STORE and SHOPIFY_THEME_TOKEN to run'

const { dir, cleanup } = tempDir()
after(cleanup)

const service = () =>
  createShopifyReadService({
    userDataDir: dir,
    storeId: 'smoke',
    storeDomain: SHOPIFY_STORE!,
    getThemeToken: async () => SHOPIFY_THEME_TOKEN!,
    image: process.env.SHOPIFY_IMAGE ?? 'shopify-builder/shopify:local',
  })

test('real image: list themes and pull one into canonical/', { skip, timeout: 15 * 60_000 }, async () => {
  const themes = await service().listThemes()
  assert.ok(themes.length > 0)
  const id = SHOPIFY_THEME_ID ? Number(SHOPIFY_THEME_ID) : (themes.find((t) => t.role === 'live') ?? themes[0]!).id
  const result = await service().pullTheme(id)
  assert.ok(result.files.includes('layout/theme.liquid'), 'pulled theme has a layout')
  assert.ok(existsSync(path.join(result.canonicalPath, 'layout', 'theme.liquid')))
  console.log(`pulled ${result.files.length} files from "${result.theme.name}" (${result.theme.role}); rejected ${result.rejected.length}`, result.rejected)
})
