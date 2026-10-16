import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openChats } from '../../src/history/chats.ts'
import { chatExpired, chatExpiryNotice, compactChat, todayUtc } from '../../src/history/retention.ts'

test('retention is 30 days and the warning starts three days before', () => {
  assert.equal(chatExpired('2026-01-01', '2026-01-30'), false)
  assert.equal(chatExpired('2026-01-01', '2026-01-31'), true)
  assert.equal(chatExpiryNotice('2026-01-01', '2026-01-28'), true)
  assert.equal(chatExpiryNotice('2026-01-01', '2026-01-31'), false)
  assert.equal(todayUtc(new Date('2026-04-02T23:30:00.000Z')), '2026-04-02')
})

test('compaction keeps the conversation and drops progress', () => {
  const lines = compactChat([
    { type: 'progress', text: 'thinking' },
    { type: 'user', text: ' Make the hero blue ' },
    { type: 'assistant', text: 'I updated the hero.' },
    { type: 'question', text: 'Which blue?' },
    { type: 'step_ready', summary: 'Recolored the hero.' },
    { type: 'user', text: '   ' },
  ])
  assert.deepEqual(lines, [
    { role: 'user', text: 'Make the hero blue' },
    { role: 'claude', text: 'I updated the hero.' },
    { role: 'claude', text: 'Which blue?' },
    { role: 'claude', text: 'Recolored the hero.' },
  ])
})

test('old chats are deleted and a recent chat stays, without storing a timestamp', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sb-chats-'))
  const chats = openChats(dir)
  chats.saveChat({
    chatId: 'old-chat',
    themeId: 3,
    title: 'Old',
    activeDay: '2026-01-01',
    messages: [{ role: 'user', text: 'hello' }],
  })
  chats.saveChat({
    chatId: 'new-chat',
    themeId: 3,
    title: 'New',
    activeDay: '2026-04-01',
    messages: [{ role: 'claude', text: 'done' }],
  })
  const removed = chats.applyRetention('2026-04-02')
  assert.deepEqual(removed, ['old-chat'])
  assert.deepEqual(chats.listChats().map((chat) => chat.chatId), ['new-chat'])
  const raw = JSON.stringify(chats.listChats())
  assert.equal(raw.includes('T'), false)
  chats.setSetting('store_domain', 'cool-store.myshopify.com')
  assert.equal(chats.getSetting('store_domain'), 'cool-store.myshopify.com')
  chats.clearSetting('store_domain')
  assert.equal(chats.getSetting('store_domain'), null)
})
