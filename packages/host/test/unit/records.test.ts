import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openRecords } from '../../src/records/store.ts'
import { tempDir } from '../helpers.ts'

test('ownership, baselines, changes, incidents, and jobs round-trip without secrets', () => {
  const { dir, cleanup } = tempDir('sb-records-')
  try {
    const records = openRecords(dir)
    records.saveOwnership({
      storeId: 'store-1',
      themeId: 10,
      kind: 'working-copy',
      name: 'Working',
      originThemeId: 1,
      retired: false,
    })
    records.saveOwnership({
      storeId: 'store-1',
      themeId: 11,
      kind: 'preview',
      name: '[Builder] Preview',
      originThemeId: null,
      retired: false,
    })
    assert.equal(records.getOwnership('store-1', 10)?.kind, 'working-copy')
    assert.equal(records.getPreview('store-1')?.themeId, 11)
    records.retire('store-1', 11)
    assert.equal(records.getPreview('store-1'), null)
    assert.equal(records.getOwnership('store-1', 11)?.retired, true)

    records.saveBaseline('a'.repeat(40), [{ check: 'SyntaxError', file: 'sections/hero.liquid', message: 'bad', severity: 'error' }])
    assert.equal(records.getBaseline('a'.repeat(40))?.[0]?.check, 'SyntaxError')

    records.saveChange({
      changeId: '11111111-1111-4111-8111-111111111111',
      storeId: 'store-1',
      themeId: 10,
      commitId: 'b'.repeat(40),
      title: 'Recolor the hero',
      sensitiveFiles: ['config/settings_data.json'],
    })
    assert.deepEqual(records.getChange('11111111-1111-4111-8111-111111111111')?.sensitiveFiles, ['config/settings_data.json'])

    records.openJob('store-1:10', '22222222-2222-4222-8222-222222222222')
    assert.equal(records.getJob('store-1:10')?.sessionId, '22222222-2222-4222-8222-222222222222')
    records.clearJob('store-1:10')
    assert.equal(records.getJob('store-1:10'), null)
    records.saveIncident('33333333-3333-4333-8333-333333333333', 'store-1', 10, 'stopped', ['sections/hero.liquid'])
  } finally {
    cleanup()
  }
})
