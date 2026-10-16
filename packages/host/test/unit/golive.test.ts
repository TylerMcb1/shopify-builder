import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { detectRoleChanges, goLiveChecklist } from '../../src/change/golive.ts'
import { GO_LIVE_STEPS, undoConflictMessage } from '../../src/change/copy.ts'
import { diffHashes, filesToTakeFromLive, hashTheme, planFileMerge } from '../../src/theme/files.ts'
import { tempDir } from '../helpers.ts'

test('the go-live checklist names each failed check and the instructions stay manual', () => {
  const items = goLiveChecklist({ unsaved: true, blocking: 2, liveChanges: ['config/settings_data.json'], previewReady: false })
  assert.deepEqual(
    items.map((item) => item.passed),
    [false, false, false, false],
  )
  assert.match(items[2]?.detail ?? '', /1 file/)
  const ready = goLiveChecklist({ unsaved: false, blocking: 0, liveChanges: [], previewReady: true })
  assert.equal(ready.every((item) => item.passed), true)
  assert.match(GO_LIVE_STEPS.join('\n'), /Choose Publish/)
  assert.match(undoConflictMessage(['Recolor the hero']), /Recolor the hero/)
  assert.match(undoConflictMessage([]), /Undo those changes first/)
})

test('a working copy that becomes live is retired and the previous live theme is kept for rollback', () => {
  const change = detectRoleChanges({
    previousLiveId: 10,
    ownership: [
      { themeId: 22, kind: 'working-copy', retired: false, name: 'Working' },
      { themeId: 9, kind: 'preview', retired: false, name: 'Preview' },
    ],
    themes: [
      { id: 22, role: 'live', name: 'Working' },
      { id: 10, role: 'unpublished', name: 'Old live' },
      { id: 9, role: 'development', name: 'Preview' },
    ],
  })
  assert.deepEqual(change.wentLive, { themeId: 22, name: 'Working' })
  assert.deepEqual(change.rollback, { themeId: 10, name: 'Old live' })
  const quiet = detectRoleChanges({
    previousLiveId: 10,
    ownership: [{ themeId: 22, kind: 'working-copy', retired: false, name: 'Working' }],
    themes: [
      { id: 10, role: 'live', name: 'Old live' },
      { id: 22, role: 'unpublished', name: 'Working' },
    ],
  })
  assert.equal(quiet.wentLive, null)
  assert.equal(quiet.rollback, null)
})

test('live edits that do not overlap are taken, and overlapping edits wait for a choice', async () => {
  const { dir, cleanup } = tempDir('sb-files-')
  try {
    writeTheme(path.join(dir, 'origin'), { 'sections/hero.liquid': 'base\n', 'sections/footer.liquid': 'base\n' })
    writeTheme(path.join(dir, 'working'), { 'sections/hero.liquid': 'mine\n', 'sections/footer.liquid': 'base\n' })
    writeTheme(path.join(dir, 'live'), { 'sections/hero.liquid': 'base\n', 'sections/footer.liquid': 'shop\n' })
    const origin = await hashTheme(path.join(dir, 'origin'))
    const working = await hashTheme(path.join(dir, 'working'))
    const live = await hashTheme(path.join(dir, 'live'))
    const plan = planFileMerge(origin, working, live)
    assert.deepEqual(plan, { takeLive: ['sections/footer.liquid'], conflicts: [] })
    assert.deepEqual(diffHashes(origin, live), ['sections/footer.liquid'])
    writeTheme(path.join(dir, 'live'), { 'sections/hero.liquid': 'theirs\n', 'sections/footer.liquid': 'shop\n' })
    const overlap = planFileMerge(origin, working, await hashTheme(path.join(dir, 'live')))
    assert.deepEqual(overlap.conflicts, ['sections/hero.liquid'])
    assert.deepEqual(filesToTakeFromLive(overlap, 'working'), ['sections/footer.liquid'])
    assert.deepEqual(filesToTakeFromLive(overlap, 'live'), ['sections/footer.liquid', 'sections/hero.liquid'])
  } finally {
    cleanup()
  }
})

function writeTheme(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), content)
  }
}
