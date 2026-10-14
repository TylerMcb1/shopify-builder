import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer')
const conversation = readFileSync(path.join(root, 'pages/ConversationPage.tsx'), 'utf8')
const setup = readFileSync(path.join(root, 'pages/SetupPage.tsx'), 'utf8')
const source = `${conversation}\n${setup}`

test('the conversation and setup screens cover the phase 4 and 5 actions', () => {
  for (const phrase of [
    'Undo this step',
    'Save to theme',
    'Unpublished',
    'Open preview',
    'Before',
    'After',
    'Desktop',
    'Mobile',
    'Show file changes',
    'Discard',
    'Make a change',
    'Pull theme',
    'not saved on disk',
  ]) {
    assert.ok(source.includes(phrase), phrase)
  }
  assert.equal(/make live|replace live|\bpublish\b/i.test(source), false)
})
