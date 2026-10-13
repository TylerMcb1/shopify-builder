import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { linkSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { intakeDirectory, DEFAULT_LIMITS } from '../../src/intake/intake.ts'
import { globToRegExp, loadPathPolicy } from '../../src/intake/policy.ts'
import { tempDir } from '../helpers.ts'

const policy = loadPathPolicy()
const { dir, cleanup } = tempDir()
after(cleanup)

const put = (rel: string, content: string | Buffer) => {
  const abs = path.join(dir, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

test('glob matching follows the shared policy semantics', () => {
  assert.ok(globToRegExp('assets/**').test('assets/a/b.css'))
  assert.ok(!globToRegExp('assets/**').test('assetsx/a.css'))
  assert.ok(globToRegExp('templates/*.json').test('templates/index.json'))
  assert.ok(!globToRegExp('templates/*.json').test('templates/customers/login.json'))
  assert.ok(globToRegExp('**/checkout*').test('layout/checkout.liquid'))
  assert.ok(globToRegExp('**/checkout*').test('checkout.liquid'))
  assert.ok(!globToRegExp('a.b').test('aXb'))
})

test('accepts theme files, rejects everything README 14.1 lists', async () => {
  put('layout/theme.liquid', '<html></html>')
  put('sections/header.liquid', '<header/>')
  put('config/settings_data.json', '{}')
  put('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  put('.git/config', '[core]')
  put('sections/.theme-check.yml', 'x')
  put('shopify.theme.toml', 'x')
  put('CLAUDE.md', 'x')
  put('package.json', '{}')
  put('random/file.liquid', 'x')
  put('layout/checkout.liquid', 'x')
  put('snippets/checkout-button.liquid', 'x')
  put('snippets/CON.liquid', 'x')
  put('snippets/trailing.liquid.', 'x')
  put('snippets/latin1.liquid', Buffer.from([0x63, 0x61, 0x66, 0xe9]))
  put('snippets/key.liquid', 'sk-ant-api03-abcdefghijklmnop')
  put('snippets/pem.liquid', '-----BEGIN RSA PRIVATE KEY-----')
  put('assets/script.exe', Buffer.from([0x4d, 0x5a]))
  put('snippets/image.png', Buffer.from([0x89]))
  put('snippets/big.liquid', 'x'.repeat(DEFAULT_LIMITS.maxTextBytes + 1))
  put('snippets/Card.liquid', 'a')
  put('snippets/card.liquid', 'b') // same file on case-insensitive filesystems (macOS, Windows)
  const caseSensitive = readdirSync(path.join(dir, 'snippets')).includes('card.liquid')
  put('snippets/a/b/c/d/e/deep.liquid', 'x')
  symlinkSync('/etc/passwd', path.join(dir, 'snippets', 'passwd.liquid'))
  symlinkSync(path.join(dir, 'layout'), path.join(dir, 'snippets', 'dirlink'))
  put('snippets/original.liquid', 'x')
  linkSync(path.join(dir, 'snippets', 'original.liquid'), path.join(dir, 'snippets', 'hardlink.liquid'))

  const { accepted, rejected } = await intakeDirectory(dir, policy)
  const reasons = Object.fromEntries(rejected.map((r) => [r.path, r.reason]))

  assert.deepEqual(accepted.map((f) => f.path).sort(), ['assets/logo.png', 'config/settings_data.json', 'layout/theme.liquid', 'sections/header.liquid', 'snippets/Card.liquid'])
  assert.deepEqual(accepted.filter((f) => f.sensitive).map((f) => f.path).sort(), ['config/settings_data.json', 'layout/theme.liquid'])
  assert.equal(accepted.find((f) => f.path === 'assets/logo.png')!.data.length, 4)

  assert.deepEqual(reasons, {
    '.git': 'dotfile',
    'sections/.theme-check.yml': 'dotfile',
    'shopify.theme.toml': 'outside-allowed-paths',
    'CLAUDE.md': 'outside-allowed-paths',
    'package.json': 'outside-allowed-paths',
    'random/file.liquid': 'outside-allowed-paths',
    'layout/checkout.liquid': 'blocked-file',
    'snippets/checkout-button.liquid': 'blocked-file',
    'snippets/CON.liquid': 'invalid-name',
    'snippets/trailing.liquid.': 'invalid-name',
    'snippets/latin1.liquid': 'invalid-utf8',
    'snippets/key.liquid': 'credential-like-content',
    'snippets/pem.liquid': 'credential-like-content',
    'assets/script.exe': 'unsupported-type',
    'snippets/image.png': 'unsupported-type',
    'snippets/big.liquid': 'too-large',
    ...(caseSensitive ? { 'snippets/card.liquid': 'case-collision' } : {}),
    'snippets/a/b/c/d/e': 'too-deep',
    'snippets/passwd.liquid': 'not-regular-file',
    'snippets/dirlink': 'not-regular-file',
    'snippets/original.liquid': 'hard-link',
    'snippets/hardlink.liquid': 'hard-link',
  })
})

test('stops on file-count and total-size limits', async () => {
  const t = tempDir()
  try {
    for (let i = 0; i < 5; i++) {
      mkdirSync(path.join(t.dir, 'snippets'), { recursive: true })
      writeFileSync(path.join(t.dir, 'snippets', `s${i}.liquid`), 'x'.repeat(10))
    }
    await assert.rejects(intakeDirectory(t.dir, policy, { ...DEFAULT_LIMITS, maxFiles: 3 }), /too many files/)
    await assert.rejects(intakeDirectory(t.dir, policy, { ...DEFAULT_LIMITS, maxTotalBytes: 25 }), /too large/)
  } finally {
    t.cleanup()
  }
})
