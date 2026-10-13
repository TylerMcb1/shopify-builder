// Sync commits with the real bundled Git (Dugite). No network.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGit, IDENTITY, type Git } from '../../src/git/git.ts'
import { createHistoryService, SHOPIFY_REF } from '../../src/git/history.ts'
import { tempDir } from '../helpers.ts'

const { dir: root, cleanup } = tempDir()
after(cleanup)

const live = { id: 111, role: 'live' }
let n = 0
const setup = async () => {
  const base = path.join(root, `case-${++n}`)
  const git = await createGit(path.join(base, 'userdata'))
  const history = createHistoryService(git)
  const gitDir = path.join(base, 'theme', 'history.git')
  return { base, git, history, gitDir }
}

/** Writes a tree directory containing exactly `files`, returning what recordSync needs. */
const tree = (base: string, name: string, files: Record<string, string | Buffer>) => {
  const dir = path.join(base, name)
  rmSync(dir, { recursive: true, force: true })
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), content)
  }
  return { treeDir: dir, files: Object.keys(files) }
}

const out = async (git: Git, gitDir: string, args: string[]) => (await git.run(gitDir, args)).stdout.toString('utf8').trim()

const THEME = {
  'layout/theme.liquid': '<html>{{ content_for_layout }}</html>\n',
  'config/settings_data.json': '{"current":"Default"}\n',
  'sections/header.liquid': '<header/>\n',
  'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a]),
}

test('first sync creates a bare history.git with one commit on shopify, tagged with the source theme', async () => {
  const { base, git, history, gitDir } = await setup()
  const result = await history.recordSync({ gitDir, ...tree(base, 'pull-1', THEME), source: live })

  assert.equal(result.created, true)
  assert.equal(result.parent, null)
  assert.equal(result.title, 'sync: pulled live theme 111')
  assert.equal(result.tag, 'sync/111/1')
  assert.deepEqual(result.changes.map((c) => c.status), ['added', 'added', 'added', 'added'])

  assert.equal(await out(git, gitDir, ['rev-parse', '--is-bare-repository']), 'true')
  assert.equal(await out(git, gitDir, ['symbolic-ref', 'HEAD']), SHOPIFY_REF)
  assert.equal(await out(git, gitDir, ['rev-parse', SHOPIFY_REF]), result.commit)
  assert.equal(await out(git, gitDir, ['rev-parse', 'refs/tags/sync/111/1']), result.commit)
  assert.equal(await out(git, gitDir, ['log', '--format=%s', SHOPIFY_REF]), 'sync: pulled live theme 111')
  assert.equal(await out(git, gitDir, ['log', '-1', '--format=%an <%ae>|%cn <%ce>', SHOPIFY_REF]), `${IDENTITY.name} <${IDENTITY.email}>|${IDENTITY.name} <${IDENTITY.email}>`)
  assert.equal(await out(git, gitDir, ['log', '-1', '--format=%B', SHOPIFY_REF]), 'sync: pulled live theme 111', 'title only, no body')

  assert.deepEqual((await out(git, gitDir, ['ls-tree', '-r', '--name-only', SHOPIFY_REF])).split('\n'), ['assets/logo.png', 'config/settings_data.json', 'layout/theme.liquid', 'sections/header.liquid'])
  const png = (await git.run(gitDir, ['cat-file', 'blob', `${SHOPIFY_REF}:assets/logo.png`])).stdout
  assert.deepEqual(png, THEME['assets/logo.png'], 'binary content stored byte for byte')

  assert.deepEqual(readdirSync(path.dirname(gitDir)), ['history.git'], 'temporary index removed; no working tree created')
  assert.ok(!existsSync(path.join(gitDir, 'hooks')), 'no sample hooks from templates')
})

test('a pull identical to the shopify branch makes no commit and no tag', async () => {
  const { base, git, history, gitDir } = await setup()
  const first = await history.recordSync({ gitDir, ...tree(base, 'pull-1', THEME), source: live })
  const second = await history.recordSync({ gitDir, ...tree(base, 'pull-2', THEME), source: live })
  assert.equal(second.created, false)
  assert.equal(second.commit, first.commit)
  assert.equal(await out(git, gitDir, ['rev-list', '--count', SHOPIFY_REF]), '1')
  assert.equal(await out(git, gitDir, ['for-each-ref', '--format=%(refname)', 'refs/tags/']), 'refs/tags/sync/111/1')
})

test('Shopify-side edits, additions and deletions become one sync commit on top of the previous one', async () => {
  const { base, git, history, gitDir } = await setup()
  const first = await history.recordSync({ gitDir, ...tree(base, 'pull-1', THEME), source: live })

  const editorEdit = { ...THEME, 'config/settings_data.json': '{"current":"Bold"}\n' }
  const second = await history.recordSync({ gitDir, ...tree(base, 'pull-2', editorEdit), source: live })
  assert.equal(second.parent, first.commit)
  assert.equal(second.title, 'sync: changes on Shopify detected in config/settings_data.json')
  assert.deepEqual(second.changes, [{ path: 'config/settings_data.json', status: 'modified' }])
  assert.equal(second.tag, 'sync/111/2')

  const { 'sections/header.liquid': _removed, ...rest } = editorEdit
  const third = await history.recordSync({ gitDir, ...tree(base, 'pull-3', { ...rest, 'snippets/new.liquid': 'x\n' }), source: live })
  assert.equal(third.title, 'sync: changes on Shopify detected in 2 files')
  assert.deepEqual(third.changes, [
    { path: 'sections/header.liquid', status: 'deleted' },
    { path: 'snippets/new.liquid', status: 'added' },
  ])

  assert.equal(await out(git, gitDir, ['log', '--format=%s', SHOPIFY_REF]), [third.title, second.title, first.title].join('\n'))
  assert.equal(await out(git, gitDir, ['show', `${SHOPIFY_REF}:config/settings_data.json`]), '{"current":"Bold"}')
})

test('the tag records which theme the files came from', async () => {
  const { base, history, gitDir } = await setup()
  await history.recordSync({ gitDir, ...tree(base, 'pull-1', THEME), source: live })
  const fromCopy = await history.recordSync({ gitDir, ...tree(base, 'pull-2', { ...THEME, 'snippets/a.liquid': 'a' }), source: { id: 222, role: 'unpublished' } })
  assert.equal(fromCopy.tag, 'sync/222/1')
})

test('ignores hooks in history.git, inherited GIT_* variables, global config and attributes', async () => {
  const { base, history, gitDir, git } = await setup()
  await history.recordSync({ gitDir, ...tree(base, 'pull-1', THEME), source: live })

  const marker = path.join(base, 'hook-ran')
  const hook = `#!/bin/sh\ntouch "${marker}"\n`
  const evilHooks = path.join(base, 'evil-hooks')
  for (const dir of [path.join(gitDir, 'hooks'), evilHooks]) {
    mkdirSync(dir, { recursive: true })
    for (const name of ['reference-transaction', 'post-commit', 'pre-commit']) {
      writeFileSync(path.join(dir, name), hook)
      chmodSync(path.join(dir, name), 0o755)
    }
  }
  const evilConfig = path.join(base, 'evil.gitconfig')
  writeFileSync(evilConfig, `[core]\n\thooksPath = ${evilHooks}\n\tautocrlf = true\n[user]\n\tname = Evil\n`)
  mkdirSync(path.join(gitDir, 'info'), { recursive: true })
  writeFileSync(path.join(gitDir, 'info', 'attributes'), '* text eol=crlf\n')

  const saved = { ...process.env }
  Object.assign(process.env, {
    GIT_DIR: path.join(base, 'elsewhere.git'),
    GIT_INDEX_FILE: path.join(base, 'evil-index'),
    GIT_CONFIG_GLOBAL: evilConfig,
    GIT_CONFIG_PARAMETERS: `'core.hooksPath=${evilHooks}'`,
    GIT_AUTHOR_NAME: 'Evil',
    GIT_OBJECT_DIRECTORY: path.join(base, 'evil-objects'),
  })
  try {
    const result = await history.recordSync({ gitDir, ...tree(base, 'pull-2', { ...THEME, 'layout/theme.liquid': 'line1\nline2\n' }), source: live })
    assert.equal(result.created, true)
    assert.equal(await out(git, gitDir, ['log', '-1', '--format=%an', SHOPIFY_REF]), IDENTITY.name)
    const blob = (await git.run(gitDir, ['cat-file', 'blob', `${SHOPIFY_REF}:layout/theme.liquid`])).stdout.toString('utf8')
    assert.equal(blob, 'line1\nline2\n', 'no line-ending conversion')
  } finally {
    process.env = saved
  }
  assert.ok(!existsSync(marker), 'no hook ran')
  assert.ok(!existsSync(path.join(base, 'elsewhere.git')) && !existsSync(path.join(base, 'evil-index')) && !existsSync(path.join(base, 'evil-objects')))
})

test('refuses to run if the app-owned hooks directory was tampered with', async () => {
  const base = path.join(root, 'tamper')
  await createGit(base)
  writeFileSync(path.join(base, 'git-support', 'empty-hooks', 'pre-commit'), '#!/bin/sh\n')
  await assert.rejects(createGit(base), /hooks directory is not empty/)
})

test('rejects unsafe paths and a branch that moved underneath the sync', async () => {
  const { base, git, history, gitDir } = await setup()
  const t = tree(base, 'pull-1', THEME)
  for (const bad of ['../escape.liquid', '/abs.liquid', 'a//b.liquid', 'a/./b.liquid', 'a\nb.liquid']) {
    await assert.rejects(history.recordSync({ gitDir, treeDir: t.treeDir, files: [...t.files, bad], source: live }), /invalid file path/)
  }

  const first = await history.recordSync({ gitDir, ...t, source: live })
  // Simulate a concurrent writer: move the branch between the parent read and the ref update.
  const racing = createHistoryService({
    initBare: git.initBare,
    run: async (dir, args, opts) => {
      if (args[0] === 'update-ref' && args.includes(SHOPIFY_REF)) {
        const other = (await git.run(dir, ['commit-tree', `${first.commit}^{tree}`, '-p', first.commit, '-m', 'change: concurrent'])).stdout.toString().trim()
        await git.run(dir, ['update-ref', SHOPIFY_REF, other])
      }
      return git.run(dir, args, opts)
    },
  })
  await assert.rejects(racing.recordSync({ gitDir, ...tree(base, 'pull-2', { ...THEME, 'snippets/x.liquid': 'x' }), source: live }), /changed during sync/)
  assert.equal(await out(git, gitDir, ['log', '-1', '--format=%s', SHOPIFY_REF]), 'change: concurrent', 'the other writer is not overwritten')
})
