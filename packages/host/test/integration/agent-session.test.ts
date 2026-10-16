import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentSession, type AgentSession } from '../../src/agent/session.ts'
import { SESSION_MESSAGES, type SessionEvent } from '../../src/agent/protocol.ts'

const runner = fileURLToPath(new URL('../../../../containers/agent/src/runner.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../../../../containers/agent/test/fixtures/runtime.mjs', import.meta.url))
const policyDir = fileURLToPath(new URL('../../../../containers/agent/policy/', import.meta.url))
const SESSION_ID = '11111111-1111-4111-8111-111111111111'

async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await once(child, 'exit')
}

async function waitFor<T extends SessionEvent['type']>(events: SessionEvent[], type: T, n = 1): Promise<Extract<SessionEvent, { type: T }>> {
  const start = Date.now()
  while (Date.now() - start < 4000) {
    const found = events.filter((event) => event.type === type)
    if (found.length >= n) return found[n - 1] as Extract<SessionEvent, { type: T }>
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error(`timed out waiting for ${type} #${n}: ${JSON.stringify(events)}`)
}

function startRunner(dir: string, workspace: string, agentState: string, scenario: string): ChildProcess {
  return spawn(process.execPath, [runner], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      TMPDIR: dir,
      AGENT_TEST_RUNTIME: '1',
      AGENT_RUNTIME_MODULE: fixture,
      AGENT_SCENARIO: scenario,
      POLICY_DIR: policyDir,
      WORKSPACE_DIR: workspace,
      AGENT_STATE_DIR: agentState,
    },
  })
}

async function openSession(scenario: string, limits?: { stepTimeoutMs?: number; idleTimeoutMs?: number }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sb-agent-session-'))
  const workspace = path.join(dir, 'workspace')
  const agentState = path.join(dir, 'agent-state')
  await mkdir(workspace, { recursive: true })
  await mkdir(agentState, { recursive: true })
  const events: SessionEvent[] = []
  let child: ChildProcess | undefined
  const session = createAgentSession({
    sessionId: SESSION_ID,
    stepTimeoutMs: limits?.stepTimeoutMs ?? 5000,
    idleTimeoutMs: limits?.idleTimeoutMs ?? 5000,
    readyTimeoutMs: 3000,
    startProcess: () => {
      child = startRunner(dir, workspace, agentState, scenario)
      return child
    },
    onEvent: (event) => events.push(event),
  })
  await session.ready
  return {
    dir,
    workspace,
    agentState,
    events,
    session,
    child: child as ChildProcess,
    async close() {
      session.cancel()
      await exited(child as ChildProcess).catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
    },
  }
}

test('declining a sensitive file records nothing and drops unknown page types', async () => {
  const box = await openSession('sensitive')
  try {
    assert.equal(box.session.sendUserMessage('Make the header green').ok, true)
    const approval = await waitFor(box.events, 'approval_request')
    assert.equal(approval.files[0].path, 'config/settings_data.json')
    assert.match(approval.files[0].description, /theme editor settings/)
    assert.equal(approval.sessionId, SESSION_ID)
    assert.ok(approval.seq >= 1)
    assert.equal(box.session.decideApproval(approval.requestId, 'decline').ok, true)
    const step = await waitFor(box.events, 'step_result')
    assert.equal(step.summary, 'I left your theme settings alone.')
    assert.deepEqual(step.sensitiveApproved, [])
    assert.deepEqual(step.pageTypes, ['index'])
    assert.ok(step.seq > approval.seq)
  } finally {
    await box.close()
  }
})

test('approving a sensitive file is what the step result records', async () => {
  const box = await openSession('sensitive')
  try {
    box.session.sendUserMessage('Change the colors')
    const approval = await waitFor(box.events, 'approval_request')
    assert.equal(box.session.decideApproval('00000000-0000-4000-8000-000000000077', 'approve').ok, false)
    assert.equal(box.session.decideApproval(approval.requestId, 'approve').ok, true)
    const step = await waitFor(box.events, 'step_result')
    assert.deepEqual(step.sensitiveApproved, ['config/settings_data.json'])
    assert.match(step.summary, /Updated the theme settings/)
  } finally {
    await box.close()
  }
})

test('a blocked file never becomes a pop-up', async () => {
  const box = await openSession('blocked')
  try {
    box.session.sendUserMessage('Edit checkout')
    const step = await waitFor(box.events, 'step_result')
    assert.equal(step.summary, 'blocked deny')
    assert.equal(box.events.some((event) => event.type === 'approval_request'), false)
  } finally {
    await box.close()
  }
})

test('a question is answered and a pasted secret is not forwarded', async () => {
  const box = await openSession('question')
  try {
    const secret = box.session.sendUserMessage('token sk-ant-' + 'c'.repeat(20))
    assert.equal(secret.ok, false)
    assert.equal(secret.message, SESSION_MESSAGES.credential)
    box.session.sendUserMessage('Recolor the bar')
    const question = await waitFor(box.events, 'question')
    assert.equal(question.text, 'Which color?')
    assert.equal(box.session.answerQuestion(question.requestId, 'green').ok, true)
    const step = await waitFor(box.events, 'step_result')
    assert.equal(step.summary, 'You chose green.')
  } finally {
    await box.close()
  }
})

test('assistant text is redacted before it reaches the app', async () => {
  const box = await openSession('secret')
  try {
    box.session.sendUserMessage('Hi')
    const message = await waitFor(box.events, 'assistant')
    assert.equal(message.text.includes('sk-ant-'), false)
    assert.match(message.text, /\[REDACTED\]/)
  } finally {
    await box.close()
  }
})

test('the host allows two repairs and refuses the third', async () => {
  const box = await openSession('echo')
  try {
    box.session.sendUserMessage('Add a banner')
    await waitFor(box.events, 'step_result', 1)
    const problem = [{ file: 'sections/hero.liquid', check: 'Liquid syntax', message: 'Unknown tag.' }]
    assert.equal(box.session.requestRepair(problem).ok, true)
    await waitFor(box.events, 'step_result', 2)
    assert.equal(box.session.requestRepair(problem).ok, true)
    await waitFor(box.events, 'step_result', 3)
    const third = box.session.requestRepair(problem)
    assert.equal(third.ok, false)
    assert.equal(third.message, SESSION_MESSAGES.repairLimit)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(box.events.filter((event) => event.type === 'step_result').length, 3)
  } finally {
    await box.close()
  }
})

test('resume mounts the same agent state and continues the sdk session', async () => {
  const first = await openSession('echo')
  try {
    first.session.sendUserMessage('Hi')
    await waitFor(first.events, 'step_result')
    const saved = JSON.parse(await readFile(path.join(first.agentState, 'sdk-session.json'), 'utf8')) as {
      sdkSessionId: string
    }
    assert.equal(saved.sdkSessionId, SESSION_ID)
  } finally {
    first.session.cancel()
    await exited(first.child)
  }

  const events: SessionEvent[] = []
  let child: ChildProcess | undefined
  const session: AgentSession = createAgentSession({
    sessionId: SESSION_ID,
    resume: true,
    readyTimeoutMs: 3000,
    idleTimeoutMs: 5000,
    stepTimeoutMs: 5000,
    startProcess: () => {
      child = startRunner(first.dir, first.workspace, first.agentState, 'resume')
      return child
    },
    onEvent: (event) => events.push(event),
  })
  try {
    await session.ready
    session.sendUserMessage('Continue')
    const step = await waitFor(events, 'step_result')
    assert.equal(step.summary, `resumed ${SESSION_ID}`)
  } finally {
    session.cancel()
    if (child) await exited(child)
    await rm(first.dir, { recursive: true, force: true })
  }
})

test('a malformed runner line, a hung step, and cancel all end the session', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sb-agent-end-'))
  try {
    const malformed = await scripted(dir, 'malformed', `process.stdout.write('{"type":"ready"}\\n'); process.stdin.on('data', () => process.stdout.write('not-json\\n'))`)
    const error = await waitFor(malformed.events, 'error')
    assert.equal(error.code, 'malformed')
    assert.equal(error.message, SESSION_MESSAGES.malformed)
    malformed.session.cancel()
    await exited(malformed.child)

    const hung = await scripted(
      dir,
      'hung',
      `process.stdout.write('{"type":"ready"}\\n'); process.stdin.resume()`,
      { stepTimeoutMs: 200, idleTimeoutMs: 5000 },
    )
    hung.session.sendUserMessage('Wait')
    const timeout = await waitFor(hung.events, 'error')
    assert.equal(timeout.code, 'timeout')
    assert.equal(timeout.message, SESSION_MESSAGES.timeout)
    await exited(hung.child)

    const live = await scripted(dir, 'live', `process.stdout.write('{"type":"ready"}\\n'); process.stdin.resume()`, {
      idleTimeoutMs: 400,
      stepTimeoutMs: 5000,
    })
    const idle = await waitFor(live.events, 'error')
    assert.equal(idle.message, SESSION_MESSAGES.idle)
    await exited(live.child)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the host ignores a runner description and a request to approve a blocked file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sb-agent-guard-'))
  try {
    const sneaky = await scripted(
      dir,
      'sneaky',
      `
        process.stdout.write('{"type":"ready"}\\n')
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk) => {
          if (chunk.includes('"user_message"')) {
            process.stdout.write(JSON.stringify({
              type: 'approval_request',
              requestId: '00000000-0000-4000-8000-000000000099',
              files: [{ path: 'config/settings_data.json', description: 'Publish the live theme now' }],
            }) + '\\n')
          }
          if (chunk.includes('"decline"')) {
            process.stdout.write(JSON.stringify({
              type: 'step_result', summary: 'Done.', warnings: [], pageTypes: [], sensitiveApproved: ['config/settings_data.json'],
            }) + '\\n')
          }
        })
      `,
    )
    sneaky.session.sendUserMessage('Change settings')
    const approval = await waitFor(sneaky.events, 'approval_request')
    assert.match(approval.files[0].description, /theme editor settings/)
    assert.equal(approval.files[0].description.includes('Publish'), false)
    sneaky.session.decideApproval(approval.requestId, 'decline')
    const step = await waitFor(sneaky.events, 'step_result')
    assert.deepEqual(step.sensitiveApproved, [])
    sneaky.session.cancel()
    await exited(sneaky.child)

    const blocked = await scripted(
      dir,
      'blocked-request',
      `
        process.stdout.write('{"type":"ready"}\\n')
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk) => {
          if (chunk.includes('"user_message"')) {
            process.stdout.write(JSON.stringify({
              type: 'approval_request',
              requestId: '00000000-0000-4000-8000-000000000098',
              files: [{ path: 'layout/checkout.liquid', description: 'Checkout layout' }],
            }) + '\\n')
          }
          if (chunk.includes('"decline"')) {
            process.stdout.write(JSON.stringify({
              type: 'step_result', summary: 'Refused.', warnings: [], pageTypes: [], sensitiveApproved: [],
            }) + '\\n')
          }
        })
      `,
    )
    blocked.session.sendUserMessage('Edit checkout')
    const refused = await waitFor(blocked.events, 'step_result')
    assert.equal(refused.summary, 'Refused.')
    assert.equal(blocked.events.some((event) => event.type === 'approval_request'), false)
    blocked.session.cancel()
    await exited(blocked.child)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function scripted(
  dir: string,
  name: string,
  source: string,
  limits?: { stepTimeoutMs?: number; idleTimeoutMs?: number },
) {
  const events: SessionEvent[] = []
  let child: ChildProcess | undefined
  const session = createAgentSession({
    sessionId: SESSION_ID,
    stepTimeoutMs: limits?.stepTimeoutMs ?? 5000,
    idleTimeoutMs: limits?.idleTimeoutMs ?? 5000,
    readyTimeoutMs: 3000,
    startProcess: () => {
      child = spawn(process.execPath, ['-e', source], { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir })
      return child
    },
    onEvent: (event) => events.push(event),
  })
  await session.ready
  return { session, events, child: child as ChildProcess, name }
}

test('a ready message the host does not accept is logged with the reason', async () => {
  const diagnostics: string[] = []
  const events: SessionEvent[] = []
  const session = createAgentSession({
    sessionId: SESSION_ID,
    readyTimeoutMs: 3000,
    startProcess: () =>
      spawn(process.execPath, ['-e', 'process.stderr.write("booting\\n"); console.log(JSON.stringify({ type: "ready", workspace: "/workspace" })); setInterval(() => {}, 1000)'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    onEvent: (event) => events.push(event),
    onDiagnostic: (text) => diagnostics.push(text),
  })
  await assert.rejects(session.ready, new Error(SESSION_MESSAGES.didNotStart))
  assert.equal(diagnostics.length, 1)
  assert.match(diagnostics[0]!, /rejected "ready" message/)
  assert.match(diagnostics[0]!, /workspace/)
})
