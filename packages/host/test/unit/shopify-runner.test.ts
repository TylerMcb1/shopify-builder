import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { THEME_CHECK_ARGS } from '../../src/validation/theme-check.ts'
import { createShopifyRunner } from '../../src/shopify/runner.ts'
import { FAKE_DOCKER, TEST_IMAGE, TEST_TOKEN, tempDir } from '../helpers.ts'

test('theme check runs with no network, no credential, and the application config', async () => {
  const { dir, cleanup } = tempDir('sb-runner-')
  const themeDir = path.join(dir, 'theme')
  const log = path.join(dir, 'docker.ndjson')
  mkdirSync(themeDir, { recursive: true })
  const runner = createShopifyRunner({
    image: TEST_IMAGE,
    getThemeToken: async () => TEST_TOKEN,
    dockerCommand: FAKE_DOCKER,
    dockerEnv: { ...process.env, FAKE_DOCKER_IMAGE: TEST_IMAGE, FAKE_DOCKER_LOG: log, FAKE_EXPECT_TOKEN: TEST_TOKEN },
  })
  try {
    const offenses = await runner.themeCheck(themeDir)
    assert.deepEqual(offenses, [
      { check: 'SyntaxError', file: 'sections/hero.liquid', message: 'Liquid did not parse.', severity: 'error' },
    ])
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
    const run = calls.find((args) => args[0] === 'run')
    assert.ok(run)
    assert.equal(run[run.indexOf('--network') + 1], 'none')
    assert.equal(run[run.indexOf('-e') + 1], 'SHOPIFY_HANDOFF=none')
    assert.match(run[run.indexOf('--mount') + 1] ?? '', /target=\/theme,readonly$/)
    assert.equal(run.includes(TEST_TOKEN), false)
    assert.ok(THEME_CHECK_ARGS.every((arg) => run.includes(arg)))
  } finally {
    cleanup()
  }
})
