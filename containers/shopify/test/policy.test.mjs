import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { checkArgs } from '../src/policy.mjs'

test('allows the permitted theme commands', () => {
  for (const sub of ['list', 'pull', 'push', 'check']) assert.equal(checkArgs(['theme', sub, '--json']), null)
})

test('refuses publish, live override, deletion and non-theme commands', () => {
  assert.ok(checkArgs(['theme', 'publish']))
  assert.ok(checkArgs(['theme', 'delete']))
  assert.ok(checkArgs(['theme', 'dev']))
  assert.ok(checkArgs(['app', 'deploy']))
  assert.ok(checkArgs([]))
  assert.ok(checkArgs(['theme', 'push', '--allow-live']))
  assert.ok(checkArgs(['theme', 'push', '-a']))
  assert.ok(checkArgs(['theme', 'push', '--publish']))
  assert.ok(checkArgs(['theme', 'push', '--delete']))
})

test('entrypoint fails closed without a credential handoff and on bad args', () => {
  const run = (args, env = {}) => spawnSync('node', ['src/entrypoint.mjs', ...args], { cwd: new URL('..', import.meta.url), env: { ...process.env, ...env }, input: '', encoding: 'utf8' })
  assert.equal(run(['theme', 'publish'], { SHOPIFY_HANDOFF: 'none' }).status, 2)
  assert.equal(run(['theme', 'list']).status, 2) // required handoff, empty stdin
  assert.equal(run(['theme', 'list'], { SHOPIFY_HANDOFF: 'bogus' }).status, 2)
})
