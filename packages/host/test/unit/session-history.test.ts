import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGit, type Git } from '../../src/git/git.ts'
import { createHistoryService, SHOPIFY_REF } from '../../src/git/history.ts'
import { createSessionHistory, sessionRef, shortTitle } from '../../src/git/session.ts'
import { tempDir } from '../helpers.ts'

const SESSION = '11111111-1111-4111-8111-111111111111'
const { dir: root, cleanup } = tempDir('sb-session-git-')
after(cleanup)

const tree = (name: string, files: Record<string, string>) => {
  const dir = path.join(root, name)
  rmSync(dir, { recursive: true, force: true })
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), content)
  }
  return { treeDir: dir, files: Object.keys(files) }
}

const THEME = {
  'layout/theme.liquid': '<html>{{ content_for_layout }}</html>\n',
  'sections/hero.liquid': 'hello\n',
  'sections/footer.liquid': '<footer/>\n',
}

test('short titles stay one line and session refs require a real id', () => {
  assert.equal(shortTitle('  hello\nworld  '), 'hello world')
  assert.equal(shortTitle(''), 'theme change')
  assert.equal(shortTitle('x'.repeat(80)).length, 72)
  assert.equal(sessionRef(SESSION), `refs/heads/session/${SESSION}`)
  assert.throws(() => sessionRef('short'))
})

test('turns, drift merges, and the saved change keep Shopify edits the session did not touch', async () => {
  const userData = path.join(root, 'user')
  const git = await createGit(userData)
  const history = createHistoryService(git)
  const sessions = createSessionHistory(git)
  const gitDir = path.join(root, 'theme', 'history.git')
  const first = await history.recordSync({ gitDir, ...tree('pull-1', THEME), source: { id: 222, role: 'unpublished' } })
  const branch = await sessions.ensureBranch(gitDir, SESSION)
  assert.equal(branch.created, true)
  assert.equal(branch.commit, first.commit)
  assert.equal((await sessions.ensureBranch(gitDir, SESSION)).created, false)

  const turnDir = tree('turn', { ...THEME, 'sections/hero.liquid': 'from session\n' })
  const turn = await sessions.commitTurn(gitDir, SESSION, turnDir.treeDir, turnDir.files, 'Recolor\nthe hero')
  assert.notEqual(turn, first.commit)
  assert.equal(await log(git, gitDir, sessionRef(SESSION)), 'turn: Recolor the hero')
  const same = await sessions.commitTurn(gitDir, SESSION, turnDir.treeDir, turnDir.files, 'again')
  assert.equal(same, turn)

  const shopifyEdit = await history.recordSync({
    gitDir,
    ...tree('pull-2', { ...THEME, 'sections/footer.liquid': '<footer>shop</footer>\n' }),
    source: { id: 222, role: 'unpublished' },
  })
  assert.equal(await sessions.mergeShopify(gitDir, SESSION), 'clean')
  assert.equal(shopifyEdit.created, true)
  assert.match(await log(git, gitDir, sessionRef(SESSION)), /merge: Shopify edits into this change/)

  const saved = await sessions.commitChange(gitDir, SESSION, shopifyEdit.commit, 'Recolor the hero')
  assert.match(await log(git, gitDir, SHOPIFY_REF), /^change: Recolor the hero/)
  assert.equal(await blob(git, gitDir, SHOPIFY_REF, 'sections/hero.liquid'), 'from session\n')
  assert.equal(await blob(git, gitDir, SHOPIFY_REF, 'sections/footer.liquid'), '<footer>shop</footer>\n')
  assert.equal(await sessions.tip(gitDir, sessionRef(SESSION)), null)
  assert.ok(saved.files.includes('sections/hero.liquid'))
  assert.equal(saved.files.includes('sections/footer.liquid'), false)

  const again = await sessions.ensureBranch(gitDir, SESSION)
  const onlyHero = tree('delete-turn', { 'sections/hero.liquid': 'only hero\n' })
  await sessions.commitTurn(gitDir, SESSION, onlyHero.treeDir, onlyHero.files, 'drop footer')
  const kept = await sessions.commitChange(gitDir, SESSION, again.commit, 'drop footer')
  assert.equal(kept.files.includes('sections/footer.liquid'), false)
  assert.equal(await blob(git, gitDir, SHOPIFY_REF, 'sections/footer.liquid'), '<footer>shop</footer>\n')

  const conflictBase = await sessions.ensureBranch(gitDir, SESSION)
  const sessionSide = tree('conflict-session', { ...THEME, 'sections/hero.liquid': 'session side\n', 'sections/footer.liquid': '<footer>shop</footer>\n' })
  await sessions.commitTurn(gitDir, SESSION, sessionSide.treeDir, sessionSide.files, 'session side')
  await history.recordSync({
    gitDir,
    ...tree('conflict-shopify', { ...THEME, 'sections/hero.liquid': 'shopify side\n', 'sections/footer.liquid': '<footer>shop</footer>\n' }),
    source: { id: 222, role: 'unpublished' },
  })
  const beforeMerge = await sessions.tip(gitDir, sessionRef(SESSION))
  assert.equal(await sessions.mergeShopify(gitDir, SESSION), 'conflict')
  assert.equal(await sessions.tip(gitDir, sessionRef(SESSION)), beforeMerge)
  const undone = await sessions.undoTurn(gitDir, SESSION, conflictBase.commit)
  assert.equal(undone, conflictBase.commit)
  assert.equal(await sessions.undoTurn(gitDir, SESSION, conflictBase.commit), null)

  const dest = path.join(root, 'materialized')
  await sessions.materialize(gitDir, SHOPIFY_REF, dest)
  assert.equal(readFileSync(path.join(dest, 'sections/footer.liquid'), 'utf8'), '<footer>shop</footer>\n')
  await sessions.deleteBranch(gitDir, SESSION)
  assert.equal(await sessions.tip(gitDir, sessionRef(SESSION)), null)
})

async function log(git: Git, gitDir: string, ref: string): Promise<string> {
  return (await git.run(gitDir, ['log', '-1', '--format=%s', ref])).stdout.toString('utf8').trim()
}

async function blob(git: Git, gitDir: string, ref: string, file: string): Promise<string> {
  return (await git.run(gitDir, ['show', `${ref}:${file}`])).stdout.toString('utf8')
}
