import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { checkArgs } from '../src/policy.mjs'

const THEME_CHECK = [
  'theme',
  'check',
  '--path',
  '/theme',
  '--config',
  'theme-check:recommended',
  '--output',
  'json',
  '--fail-level',
  'crash',
  '--no-color',
  '--no-input',
]

test('allows the permitted theme commands', () => {
  assert.equal(checkArgs(['theme', 'list', '--json']), null)
  assert.equal(checkArgs(['theme', 'pull', '--theme', '123', '--path', '/inbox', '--store', 'x.myshopify.com', '--no-color']), null)
  assert.equal(checkArgs(['theme', 'pull', '--theme=123', '--path=/inbox']), null)
  assert.equal(
    checkArgs([
      'theme',
      'push',
      '--path',
      '/theme',
      '--store',
      'x.myshopify.com',
      '--nodelete',
      '--json',
      '--no-color',
      '--no-input',
      '--theme',
      '123',
      '--only',
      'sections/hero.liquid',
    ]),
    null,
  )
  assert.equal(
    checkArgs(['theme', 'push', '--path', '/theme', '--store', 'x.myshopify.com', '--nodelete', '--json', '--no-color', '--no-input', '--theme', '123']),
    null,
  )
  assert.equal(
    checkArgs([
      'theme',
      'push',
      '--path',
      '/theme',
      '--store',
      'x.myshopify.com',
      '--nodelete',
      '--json',
      '--no-color',
      '--no-input',
      '--unpublished',
      '--theme',
      '[Builder] Working copy',
    ]),
    null,
  )
  assert.equal(
    checkArgs(['theme', 'push', '--path', '/theme', '--store', 'x.myshopify.com', '--nodelete', '--json', '--no-color', '--no-input', '--development']),
    null,
  )
  assert.equal(checkArgs(THEME_CHECK), null)
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
  assert.ok(checkArgs(['theme', 'push', '--live']))
  assert.ok(checkArgs(['theme', 'push', '-d']))
  assert.ok(checkArgs(['theme', 'push', '-l']))
})

test('push and theme check only accept the application forms', () => {
  const base = ['theme', 'push', '--path', '/theme', '--store', 'x.myshopify.com', '--nodelete', '--json', '--no-color', '--no-input']
  assert.equal(checkArgs([...base, '--theme', '123', '--only', 'sections/hero.liquid']), null)
  assert.ok(checkArgs(base))
  assert.ok(checkArgs([...base, '--unpublished', '--theme', '[Builder] Working copy', '--only', 'sections/hero.liquid']))
  assert.ok(checkArgs([...base, '--development', '--theme', '123']))
  assert.ok(checkArgs([...base, '--theme', 'Dawn']))
  assert.ok(checkArgs([...base, '--theme', '123', '--only', 'sections/*']))
  assert.ok(checkArgs([...base, '--path', '/inbox', '--theme', '123']))
  assert.ok(checkArgs(['theme', 'check', '--path', '/theme', '--config', 'theme-check:recommended', '--output', 'json', '--fail-level', 'error', '--no-input']))
  assert.ok(checkArgs(['theme', 'check', '--path', '/theme', '--config', '.theme-check.yml', '--output', 'json', '--fail-level', 'crash', '--no-input']))
})

test('entrypoint fails closed without a credential handoff and on bad args', () => {
  const run = (args, env = {}) => spawnSync('node', ['src/entrypoint.mjs', ...args], { cwd: new URL('..', import.meta.url), env: { ...process.env, ...env }, input: '', encoding: 'utf8' })
  assert.equal(run(['theme', 'publish'], { SHOPIFY_HANDOFF: 'none' }).status, 2)
  assert.equal(run(['theme', 'list']).status, 2) // required handoff, empty stdin
  assert.equal(run(['theme', 'list'], { SHOPIFY_HANDOFF: 'bogus' }).status, 2)
  const push = ['theme', 'push', '--path', '/theme', '--store', 'x.myshopify.com', '--nodelete', '--json', '--no-color', '--no-input', '--development']
  const pushed = run(push, { SHOPIFY_HANDOFF: 'none' })
  assert.equal(pushed.status, 2)
  assert.match(pushed.stderr, /credential required/)
  const checked = run(THEME_CHECK)
  assert.equal(checked.status, 2)
  assert.match(checked.stderr, /does not take a credential/)
})
