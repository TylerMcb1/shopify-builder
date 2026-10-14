import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeThemeFile, themeFileAccess } from '../../src/agent/descriptions.ts'
import { presentStep, presentText, reviewApprovalRequest } from '../../src/agent/present.ts'
import {
  AGENT_MAX_REPAIRS,
  AGENT_MAX_TURNS,
  HostToRunnerSchema,
  PROGRESS_LABELS,
  RunnerMessageSchema,
  SessionEventSchema,
} from '../../src/agent/protocol.ts'

const session = { sessionId: 'session-1', seq: 1 }

test('runner messages are strict and cannot carry host paths', () => {
  assert.equal(RunnerMessageSchema.safeParse({ type: 'ready' }).success, true)
  assert.equal(RunnerMessageSchema.safeParse({ type: 'ready', workspace: '/Users/me' }).success, false)
  assert.equal(
    RunnerMessageSchema.safeParse({
      type: 'approval_request',
      requestId: '00000000-0000-4000-8000-000000000001',
      files: [{ path: '/etc/passwd', description: 'nope' }],
    }).success,
    false,
  )
  assert.equal(RunnerMessageSchema.safeParse({ type: 'assistant', text: '' }).success, false)
  const step = RunnerMessageSchema.safeParse({
    type: 'step_result',
    summary: 'Done.',
    warnings: [],
    pageTypes: ['index'],
    sensitiveApproved: ['config/settings_data.json'],
  })
  assert.equal(step.success, true)
})

test('the host rewrites approval text and refuses blocked files', () => {
  const sneaky = reviewApprovalRequest([
    { path: 'config/settings_data.json', description: 'Publish the live theme now' },
  ])
  assert.equal(sneaky.action, 'ask')
  if (sneaky.action !== 'ask') return
  assert.equal(sneaky.files[0].description, describeThemeFile('config/settings_data.json'))
  assert.equal(sneaky.files[0].description.includes('Publish'), false)
  assert.equal(reviewApprovalRequest([{ path: 'layout/checkout.liquid', description: 'Checkout' }]).action, 'decline')
  assert.equal(reviewApprovalRequest([{ path: 'notes.txt', description: 'Notes' }]).action, 'decline')
  assert.equal(themeFileAccess('sections/hero.liquid'), 'allowed')
  assert.equal(themeFileAccess('sections/header-group.json'), 'sensitive')
})

test('step results keep the host approval record and known page types only', () => {
  const parsed = RunnerMessageSchema.parse({
    type: 'step_result',
    summary: 'Updated. sk-ant-' + 'a'.repeat(20),
    warnings: ['looks fine'],
    pageTypes: ['index', 'not-a-page'],
    sensitiveApproved: ['layout/checkout.liquid'],
  })
  if (parsed.type !== 'step_result') throw new Error('expected a step')
  const presented = presentStep(parsed, ['config/settings_data.json'])
  assert.match(presented.summary, /\[REDACTED\]/)
  assert.equal(presented.summary.includes('sk-ant-'), false)
  assert.deepEqual(presented.pageTypes, ['index'])
  assert.deepEqual(presented.sensitiveApproved, ['config/settings_data.json'])
  assert.equal(presentText('sk-ant-' + 'b'.repeat(20)), '[REDACTED]')
})

test('repair progress uses the plain-language label', () => {
  assert.equal(PROGRESS_LABELS.repairing, 'Fixing a problem I found…')
  const event = SessionEventSchema.parse({
    ...session,
    type: 'progress',
    stage: 'repairing',
    label: PROGRESS_LABELS.repairing,
  })
  assert.equal(event.type, 'progress')
})

test('host commands reject extra fields and a third repair is a host decision', () => {
  assert.equal(HostToRunnerSchema.safeParse({ type: 'start', resume: true, token: 'x' }).success, false)
  assert.equal(HostToRunnerSchema.safeParse({ type: 'cancel' }).success, true)
  assert.equal(HostToRunnerSchema.safeParse({ type: 'user_message', text: 'Hi' }).success, true)
  assert.equal(AGENT_MAX_REPAIRS, 2)
  assert.equal(AGENT_MAX_TURNS, 8)
})
