import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPROVAL_APPROVE_LABEL,
  APPROVAL_DECLINE_LABEL,
  APPROVAL_MESSAGE,
  APPROVAL_PREVIEW_LABEL,
  APPROVAL_TITLE,
  approvalKeyAction,
} from '../src/shared/approval.ts'

const dialog = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/components/ApprovalDialog.tsx'),
  'utf8',
)

test('the pop-up uses the README copy and Decline is the default', () => {
  assert.equal(APPROVAL_TITLE, 'Approve changes to important theme files?')
  assert.equal(
    APPROVAL_MESSAGE,
    'Claude wants to change files that control settings you may have customized in the Shopify theme editor. Changing them could overwrite those customizations.',
  )
  assert.equal(APPROVAL_DECLINE_LABEL, 'Decline')
  assert.equal(APPROVAL_APPROVE_LABEL, 'Approve')
  assert.equal(APPROVAL_PREVIEW_LABEL, 'Show what will change')
  assert.equal(approvalKeyAction('Escape'), 'decline')
  assert.equal(approvalKeyAction('Enter'), null)
  assert.match(dialog, /autoFocus/)
  assert.match(dialog, /approvalKeyAction/)
  assert.ok(dialog.indexOf('{APPROVAL_DECLINE_LABEL}') < dialog.indexOf('{APPROVAL_APPROVE_LABEL}'))
  assert.match(dialog, /preview \?/)
})
