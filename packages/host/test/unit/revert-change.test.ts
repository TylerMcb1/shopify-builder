import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGit, type Git } from '../../src/git/git.ts'
import { createHistoryService, SHOPIFY_REF } from '../../src/git/history.ts'
import { createSessionHistory } from '../../src/git/session.ts'
import { tempDir } from '../helpers.ts'

const SESSION = '11111111-1111-4111-8111-111111111111'
const { dir: root, cleanup } = tempDir('sb-revert-')
after(cleanup)

const THEME = {
  'layout/theme.liquid': '<html></html>\n',
  'sections/hero.liquid': 'hello\n',
  'sections/footer.liquid': '<footer/>\n',
}

test('a saved change reverts when later changes use other files, and conflicts when they do not', async () => {
  const userData = path.join(root, 'user')
  const git = await createGit(userData)
  const history = createHistoryService(git)
  const sessions = createSessionHistory(git)
  const gitDir = path.join(root, 'theme', 'history.git')
  await history.recordSync({ gitDir, ...tree('base', THEME), source: { id: 222, role: 'unpublished' } })

  const hero = await saveChange(sessions, gitDir, 'hero', { ...THEME, 'sections/hero.liquid': 'blue\n' }, 'Recolor the hero')
  await saveChange(sessions, gitDir, 'footer', { ...THEME, 'sections/hero.liquid': 'blue\n', 'sections/footer.liquid': '<footer>new</footer>\n' }, 'Update the footer')
  const reverted = await sessions.revertChange(gitDir, hero, 'Recolor the hero')
  assert.equal(reverted.ok, true)
  if (!reverted.ok) return
  assert.equal(await blob(git, gitDir, SHOPIFY_REF, 'sections/hero.liquid'), 'hello\n')
  assert.equal(await blob(git, gitDir, SHOPIFY_REF, 'sections/footer.liquid'), '<footer>new</footer>\n')
  assert.match(await subject(git, gitDir), /^revert: Recolor the hero/)

  const again = await saveChange(sessions, gitDir, 'hero-2', { ...THEME, 'sections/hero.liquid': 'green\n', 'sections/footer.liquid': '<footer>new</footer>\n' }, 'Green hero')
  const later = await saveChange(sessions, gitDir, 'hero-3', { ...THEME, 'sections/hero.liquid': 'red\n', 'sections/footer.liquid': '<footer>new</footer>\n' }, 'Red hero')
  const blocked = await sessions.revertChange(gitDir, again, 'Green hero')
  assert.equal(blocked.ok, false)
  if (blocked.ok) return
  assert.deepEqual(blocked.files, ['sections/hero.liquid'])
  const after = await sessions.commitsAfter(gitDir, again)
  assert.equal(after.includes(later), true)
  assert.equal(await blob(git, gitDir, SHOPIFY_REF, 'sections/hero.liquid'), 'red\n')
})

test('a clean live merge keeps both sides and a conflict lists the file', async () => {
  const userData = path.join(root, 'user-merge')
  const git = await createGit(userData)
  const history = createHistoryService(git)
  const sessions = createSessionHistory(git)
  const gitDir = path.join(root, 'merge', 'history.git')
  const base = await history.recordSync({ gitDir, ...tree('merge-base', THEME), source: { id: 222, role: 'unpublished' } })
  await saveChange(sessions, gitDir, 'working', { ...THEME, 'sections/hero.liquid': 'mine\n' }, 'My hero')
  const liveDir = tree('live', { ...THEME, 'sections/footer.liquid': '<footer>shop</footer>\n' }).treeDir
  const live = await sessions.snapshotCommit(gitDir, liveDir)
  const merged = await sessions.mergeCommits(gitDir, base.commit, (await sessions.tip(gitDir, SHOPIFY_REF)) ?? '', live)
  assert.equal(merged.ok, true)
  if (!merged.ok) return
  assert.equal(await blob(git, gitDir, merged.commit, 'sections/hero.liquid'), 'mine\n')
  assert.equal(await blob(git, gitDir, merged.commit, 'sections/footer.liquid'), '<footer>shop</footer>\n')
  assert.equal(await sessions.root(gitDir), base.commit)

  const clashDir = tree('clash', { ...THEME, 'sections/hero.liquid': 'theirs\n' }).treeDir
  const clash = await sessions.snapshotCommit(gitDir, clashDir)
  const conflict = await sessions.mergeCommits(gitDir, base.commit, (await sessions.tip(gitDir, SHOPIFY_REF)) ?? '', clash)
  assert.equal(conflict.ok, false)
  if (conflict.ok) return
  assert.ok(conflict.files.some((file) => file.includes('sections/hero.liquid')))
})

async function saveChange(
  sessions: ReturnType<typeof createSessionHistory>,
  gitDir: string,
  name: string,
  files: Record<string, string>,
  title: string,
): Promise<string> {
  const branch = await sessions.ensureBranch(gitDir, SESSION)
  const dir = tree(name, files)
  await sessions.commitTurn(gitDir, SESSION, dir.treeDir, dir.files, title)
  const saved = await sessions.commitChange(gitDir, SESSION, branch.commit, title)
  return saved.commit
}

function tree(name: string, files: Record<string, string>) {
  const treeDir = path.join(root, name)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(treeDir, rel)), { recursive: true })
    writeFileSync(path.join(treeDir, rel), content)
  }
  return { treeDir, files: Object.keys(files) }
}

async function blob(git: Git, gitDir: string, ref: string, file: string): Promise<string> {
  return (await git.run(gitDir, ['show', `${ref}:${file}`])).stdout.toString('utf8')
}

async function subject(git: Git, gitDir: string): Promise<string> {
  return (await git.run(gitDir, ['log', '-1', '--format=%s', SHOPIFY_REF])).stdout.toString('utf8').trim()
}
