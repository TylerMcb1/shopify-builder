// End-to-end pull through the host read service, the Docker adapter, the encrypted handoff and the
// real Shopify container entrypoint. Docker and the Shopify CLI are replaced by fixtures; no network.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGit, createShopifyReadService, HostError, type ShopifyReadServiceConfig } from '../../src/index.ts'
import { FAKE_DOCKER, TEST_IMAGE, TEST_TOKEN, tempDir } from '../helpers.ts'

const { dir: userData, cleanup } = tempDir()
after(cleanup)
const dockerLog = path.join(userData, 'docker-calls.ndjson')

const service = (scenario = 'ok', extra: Partial<ShopifyReadServiceConfig> = {}, env: NodeJS.ProcessEnv = {}) =>
  createShopifyReadService({
    userDataDir: userData,
    storeId: 'store-1',
    storeDomain: 'example.myshopify.com',
    getThemeToken: async () => TEST_TOKEN,
    image: TEST_IMAGE,
    dockerCommand: FAKE_DOCKER,
    dockerEnv: { ...process.env, FAKE_DOCKER_IMAGE: TEST_IMAGE, FAKE_DOCKER_LOG: dockerLog, FAKE_EXPECT_TOKEN: TEST_TOKEN, FAKE_SHOPIFY_SCENARIO: scenario, ...env },
    listTimeoutMs: 20_000,
    pullTimeoutMs: 20_000,
    ...extra,
  })

const themeDir = (id: number) => path.join(userData, 'stores', 'store-1', 'themes', String(id))
const gitRunner = createGit(path.join(userData, 'test-git'))
const git = async (id: number, args: string[]) => (await (await gitRunner).run(path.join(themeDir(id), 'history.git'), args)).stdout.toString('utf8').trim()
const dockerCalls = (): string[][] => (existsSync(dockerLog) ? readFileSync(dockerLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
const expectHostError = (code: string) => (err: unknown) => err instanceof HostError && err.code === code

beforeEach(() => rmSync(dockerLog, { force: true }))

test('lists themes through the container with the token delivered only via handoff', async () => {
  const themes = await service().listThemes()
  assert.deepEqual(themes, [
    { id: 111, name: 'Dawn', role: 'live' },
    { id: 222, name: '[Builder] Working copy', role: 'unpublished' },
  ])
  const run = dockerCalls().find((c) => c[0] === 'run')!
  assert.deepEqual(run.slice(run.indexOf(TEST_IMAGE) + 1), ['theme', 'list', '--json', '--no-color', '--store', 'example.myshopify.com'])
  assert.ok(!JSON.stringify(dockerCalls()).includes(TEST_TOKEN))
})

test('pulls the live theme (read-only) by id into canonical/, keeping only files that pass intake', async () => {
  const result = await service().pullTheme(111)

  assert.deepEqual(result.theme, { id: 111, name: 'Dawn', role: 'live' })
  assert.equal(result.canonicalPath, path.join(themeDir(111), 'canonical'))
  assert.deepEqual(result.files, ['assets/logo.png', 'config/settings_data.json', 'layout/theme.liquid', 'locales/en.default.json', 'sections/header.liquid', 'snippets/old-only.liquid', 'templates/index.json'])
  assert.deepEqual(result.sensitiveFiles, ['config/settings_data.json', 'layout/theme.liquid', 'locales/en.default.json', 'templates/index.json'])
  assert.deepEqual(Object.fromEntries(result.rejected.map((r) => [r.path, r.reason])), {
    '.shopify': 'dotfile',
    'layout/checkout.liquid': 'blocked-file',
    'shopify.theme.toml': 'outside-allowed-paths',
    'snippets/latin1.liquid': 'invalid-utf8',
    'snippets/leak.liquid': 'credential-like-content',
    'snippets/link.liquid': 'not-regular-file',
  })

  assert.equal(readFileSync(path.join(result.canonicalPath, 'layout/theme.liquid'), 'utf8'), '<html>{{ content_for_layout }} v1</html>')
  assert.ok(!existsSync(path.join(result.canonicalPath, 'layout/checkout.liquid')))
  assert.ok(!existsSync(path.join(result.canonicalPath, '.shopify')))
  assert.ok(!existsSync(path.join(themeDir(111), 'inbox')), 'inbox is removed after intake')
  assert.deepEqual(readdirSync(themeDir(111)).sort(), ['canonical', 'history.git'], 'no staging or index leftovers')

  assert.equal(result.sync.created, true)
  assert.equal(result.sync.title, 'sync: pulled live theme 111')
  assert.equal(result.sync.tag, 'sync/111/1')
  assert.equal(await git(111, ['log', '--format=%s', 'refs/heads/shopify']), 'sync: pulled live theme 111')
  assert.deepEqual((await git(111, ['ls-tree', '-r', '--name-only', 'refs/heads/shopify'])).split('\n'), result.files, 'commit holds exactly the files that passed intake')

  const run = dockerCalls().filter((c) => c[0] === 'run').at(-1)!
  assert.deepEqual(run.slice(run.indexOf(TEST_IMAGE) + 1), ['theme', 'pull', '--theme', '111', '--path', '/inbox', '--store', 'example.myshopify.com', '--no-color'])
  assert.equal(run[run.indexOf('--mount') + 1], `type=bind,source=${path.join(themeDir(111), 'inbox')},target=/inbox`)
  assert.ok(!JSON.stringify(dockerCalls()).includes(TEST_TOKEN))
})

test('a re-pull replaces canonical/ and records only real Shopify changes as sync commits', async () => {
  const first = await service().pullTheme(222)
  assert.equal(first.sync.title, 'sync: pulled unpublished theme 222')

  const unchanged = await service().pullTheme(222)
  assert.equal(unchanged.sync.created, false)
  assert.equal(unchanged.sync.commit, first.sync.commit)

  const second = await service('ok', {}, { FAKE_PULL_VERSION: '2' }).pullTheme(222)
  assert.ok(!second.files.includes('snippets/old-only.liquid'))
  assert.ok(!existsSync(path.join(second.canonicalPath, 'snippets/old-only.liquid')))
  assert.match(readFileSync(path.join(second.canonicalPath, 'layout/theme.liquid'), 'utf8'), /v2/)

  assert.equal(second.sync.parent, first.sync.commit)
  assert.equal(second.sync.title, 'sync: changes on Shopify detected in 2 files')
  assert.deepEqual(second.sync.changes, [
    { path: 'layout/theme.liquid', status: 'modified' },
    { path: 'snippets/old-only.liquid', status: 'deleted' },
  ])
  assert.equal(await git(222, ['rev-list', '--count', 'refs/heads/shopify']), '2')
  assert.match(await git(222, ['show', 'refs/heads/shopify:layout/theme.liquid']), /v2/)
})

test('refuses theme ids that are invalid or not in the fresh theme list', async () => {
  for (const bad of [0, -1, 1.5, Number.NaN, '111' as unknown as number]) {
    await assert.rejects(service().pullTheme(bad), expectHostError('invalid-input'))
  }
  await assert.rejects(service().pullTheme(999), expectHostError('theme-not-found'))
  await assert.rejects(
    service('ok', {}, { FAKE_THEMES: JSON.stringify([{ id: 5, name: 'a', role: 'unpublished' }, { id: 5, name: 'b', role: 'unpublished' }]) }).pullTheme(5),
    expectHostError('invalid-output'),
  )
  assert.ok(!existsSync(themeDir(999)) || !existsSync(path.join(themeDir(999), 'canonical')))
})

test('CLI failure keeps the previous canonical/ and redacts the token from the error', async () => {
  const before = readFileSync(path.join(themeDir(222), 'canonical', 'layout/theme.liquid'), 'utf8')
  const tipBefore = await git(222, ['rev-parse', 'refs/heads/shopify'])
  const err = await service('pull-fails').pullTheme(222).then(() => null, (e: unknown) => e)
  assert.equal(await git(222, ['rev-parse', 'refs/heads/shopify']), tipBefore, 'no sync commit for a failed pull')
  assert.ok(err instanceof HostError && err.code === 'cli-failed', String(err))
  assert.ok(!String(err.detail).includes(TEST_TOKEN) && !err.message.includes(TEST_TOKEN))
  assert.match(String(err.detail), /\[REDACTED\]/)
  assert.equal(readFileSync(path.join(themeDir(222), 'canonical', 'layout/theme.liquid'), 'utf8'), before)
  assert.ok(!existsSync(path.join(themeDir(222), 'inbox')))
})

test('wrong credential and empty pulls fail with plain-language errors', async () => {
  await assert.rejects(service('ok', { getThemeToken: async () => 'shptka_wrong' }).listThemes(), expectHostError('cli-failed'))
  await assert.rejects(service('empty').pullTheme(111), expectHostError('empty-pull'))
  await assert.rejects(service('bad-list').listThemes(), expectHostError('invalid-output'))
})

test('Docker missing or slow is reported, and a timed-out container is force-removed', async () => {
  await assert.rejects(service('ok', { dockerCommand: path.join(userData, 'no-such-docker') }).listThemes(), expectHostError('docker-unavailable'))

  const slow = service('ok', { listTimeoutMs: 1, getThemeToken: () => new Promise(() => {}) })
  await assert.rejects(slow.listThemes(), expectHostError('timeout'))
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(dockerCalls().some((c) => c[0] === 'rm' && c[1] === '-f' && c[2]?.startsWith('sb-shopify-')))
})

test('the same theme cannot be pulled twice at once', async () => {
  const s = service()
  const first = s.pullTheme(111)
  await assert.rejects(s.pullTheme(111), expectHostError('busy'))
  await first
})

test('if the sync commit fails, canonical/ is left exactly as it was', async () => {
  const canonicalFile = path.join(themeDir(111), 'canonical', 'layout/theme.liquid')
  const before = readFileSync(canonicalFile, 'utf8')
  const gitDir = path.join(themeDir(111), 'history.git')
  renameSync(gitDir, `${gitDir}.bak`)
  writeFileSync(gitDir, 'not a repository')
  try {
    await assert.rejects(service('ok', {}, { FAKE_PULL_VERSION: '3' }).pullTheme(111), expectHostError('history-failed'))
    assert.equal(readFileSync(canonicalFile, 'utf8'), before)
    assert.deepEqual(readdirSync(themeDir(111)).sort(), ['canonical', 'history.git', 'history.git.bak'], 'staging, inbox and index cleaned up')
  } finally {
    rmSync(gitDir)
    renameSync(`${gitDir}.bak`, gitDir)
  }
})

test('rejects invalid configuration up front', () => {
  assert.throws(() => service('ok', { storeDomain: 'evil.com' }))
  assert.throws(() => service('ok', { storeId: '../escape' }))
  assert.throws(() => service('ok', { userDataDir: 'relative' }))
})
