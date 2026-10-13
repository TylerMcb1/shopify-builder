import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { checkArgs } from '../src/policy.mjs'

test('allows the permitted theme commands', () => {
  for (const sub of ['list', 'push', 'check']) assert.equal(checkArgs(['theme', sub, '--json']), null)
  assert.equal(checkArgs(['theme', 'pull', '--theme', '123', '--path', '/inbox', '--store', 'x.myshopify.com', '--no-color']), null)
  assert.equal(checkArgs(['theme', 'pull', '--theme=123', '--path=/inbox']), null)
})

test('pull is only by numeric theme id into /inbox', () => {
  assert.ok(checkArgs(['theme', 'pull', '--path', '/inbox'])) // no theme id
  assert.ok(checkArgs(['theme', 'pull', '--theme', 'Dawn', '--path', '/inbox']))
  assert.ok(checkArgs(['theme', 'pull', '--theme', '123', '--path', '/workspace']))
  assert.ok(checkArgs(['theme', 'pull', '--theme', '123']))
  assert.ok(checkArgs(['theme', 'pull', '--live', '--path', '/inbox']))
  assert.ok(checkArgs(['theme', 'pull', '--theme', '1', '--theme', '2', '--path', '/inbox']))
  assert.ok(checkArgs(['theme', 'pull', '--theme', '123', '--path', '/inbox', '--only', 'config/*']))
})

test('refuses flags that carry secrets or read theme-directory config', () => {
  assert.ok(checkArgs(['theme', 'list', '--password', 'shptka_x']))
  assert.ok(checkArgs(['theme', 'list', '--password=shptka_x']))
  assert.ok(checkArgs(['theme', 'list', '--environment', 'prod']))
  assert.ok(checkArgs(['theme', 'pull', '--theme', '1', '--path', '/inbox', '--force']))
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
