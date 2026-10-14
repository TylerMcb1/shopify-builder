import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideToolUse, describeThemeFile, globToRegExp, isThemePath, loadPolicy, matchesAny } from '../src/permissions.mjs'

const policyDir = fileURLToPath(new URL('../policy/', import.meta.url))
const policy = loadPolicy(policyDir)
const root = '/workspace'

const descriptions = {
  'config/settings_data.json': 'Your theme editor settings, such as colors, fonts, and section content.',
  'config/settings_schema.json': 'The list of settings available in the theme editor.',
  'templates/index.json': 'Page layouts and section content you set up in the theme editor.',
  'templates/customers/account.json': 'Page layouts and section content you set up in the theme editor.',
  'sections/header-group.json': 'Header and footer content you set up in the theme editor.',
  'layout/theme.liquid': 'The master layout used by every page of your store.',
  'locales/en.default.json': "Your store's text and translations, including edits made with 'Edit default theme content'.",
}

test('every sensitive file uses the description from the policy', () => {
  for (const [file, description] of Object.entries(descriptions)) {
    assert.equal(describeThemeFile(file, policy), description, file)
    const decision = decideToolUse({
      toolName: 'Write',
      input: { file_path: `${root}/${file}` },
      workspaceRoot: root,
      policy,
      alreadyApproved: new Set(),
    })
    assert.equal(decision.behavior, 'approve', file)
    assert.equal(decision.files[0].description, description)
  }
})

test('reading a sensitive file does not ask, and a second write does not ask again', () => {
  const read = decideToolUse({
    toolName: 'Read',
    input: { file_path: `${root}/config/settings_data.json` },
    workspaceRoot: root,
    policy,
    alreadyApproved: new Set(),
  })
  assert.equal(read.behavior, 'allow')
  const again = decideToolUse({
    toolName: 'Edit',
    input: { file_path: `${root}/config/settings_data.json` },
    workspaceRoot: root,
    policy,
    alreadyApproved: new Set(['config/settings_data.json']),
  })
  assert.equal(again.behavior, 'allow')
})

test('blocked, outside, and escaped paths are denied with no approval', () => {
  const cases = [
    ['Write', { file_path: `${root}/layout/checkout.liquid` }],
    ['Write', { file_path: `${root}/templates/checkout.json` }],
    ['Read', { file_path: `${root}/notes.txt` }],
    ['Read', { file_path: '/etc/passwd' }],
    ['Write', { file_path: `${root}/sections/../../etc/passwd` }],
    ['Bash', { command: 'ls' }],
    ['Read', { file_path: `${root}/.env` }],
  ]
  for (const [toolName, input] of cases) {
    const decision = decideToolUse({ toolName, input, workspaceRoot: root, policy, alreadyApproved: new Set() })
    assert.equal(decision.behavior, 'deny', toolName + ' ' + JSON.stringify(input))
  }
})

test('ordinary theme files and searches at the workspace root are allowed', () => {
  const write = decideToolUse({
    toolName: 'Write',
    input: { file_path: `${root}/sections/hero.liquid` },
    workspaceRoot: root,
    policy,
    alreadyApproved: new Set(),
  })
  assert.equal(write.behavior, 'allow')
  assert.equal(write.mutating, true)
  const search = decideToolUse({
    toolName: 'Grep',
    input: { path: root },
    workspaceRoot: root,
    policy,
    alreadyApproved: new Set(),
  })
  assert.equal(search.behavior, 'allow')
})

test('theme paths reject traversal and dotfiles', () => {
  assert.equal(isThemePath('sections/hero.liquid'), true)
  for (const bad of ['/etc/passwd', '../x', 'sections/../x', '.env', 'a//b', 'layout/checkout.liquid/..']) {
    assert.equal(isThemePath(bad), false, bad)
  }
})

test('globs match the host implementation', async () => {
  const host = await import('../../../packages/host/src/intake/policy.ts')
  const samples = [
    'assets/logo.png',
    'templates/customers/account.json',
    'layout/checkout.liquid',
    'sections/header-group.json',
    'config/settings_data.json',
    'notes.txt',
  ]
  const globs = [...policy.allowed, ...policy.blocked, ...policy.sensitive]
  for (const glob of globs) {
    const hostRe = host.globToRegExp(glob)
    const agentRe = globToRegExp(glob)
    for (const sample of samples) {
      assert.equal(agentRe.test(sample), hostRe.test(sample), `${glob} ${sample}`)
    }
    assert.equal(matchesAny(samples[0], [glob]), host.matchesAny(samples[0], [glob]))
  }
})
