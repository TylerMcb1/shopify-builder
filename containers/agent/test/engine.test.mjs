import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { buildSystemPrompt, runEngine } from '../src/engine.mjs'
import { loadPolicy } from '../src/permissions.mjs'

const policy = loadPolicy(fileURLToPath(new URL('../policy/', import.meta.url)))
const SESSION = '11111111-1111-4111-8111-111111111111'

function harness(runtime, limits = {}) {
  const input = new PassThrough()
  const messages = []
  const state = mkdtemp(path.join(tmpdir(), 'sb-engine-')).then(async (dir) => {
    const engine = runEngine({
      input,
      send: (message) => messages.push(message),
      runtime,
      policy,
      workspaceRoot: '/workspace',
      agentStateDir: dir,
      systemPrompt: 'test',
      limits,
      onCancel: () => input.end(),
    })
    return { dir, engine }
  })
  return {
    input,
    messages,
    state,
    send(message) {
      input.write(JSON.stringify(message) + '\n')
    },
    async cleanup() {
      input.end()
      const { dir, engine } = await state
      await engine.finished
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function waitFor(messages, type, n = 1) {
  const start = Date.now()
  while (Date.now() - start < 2000) {
    const found = messages.filter((message) => message.type === type)
    if (found.length >= n) return found[n - 1]
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${type} #${n}: ${JSON.stringify(messages)}`)
}

const echo = {
  async runTurn() {
    return { sessionId: SESSION, summary: 'Done.', warnings: [], pageTypes: ['index'] }
  },
}

test('a sensitive write waits for approval and records a decline', async () => {
  let decision = null
  const box = harness({
    async runTurn(ctx) {
      ctx.hooks.onAssistant('I need to change your theme settings.')
      decision = await ctx.hooks.canUseTool('Write', { file_path: '/workspace/config/settings_data.json' })
      const summary = decision.behavior === 'allow' ? 'Updated the theme settings.' : 'I left your theme settings alone.'
      return { sessionId: SESSION, summary, warnings: [], pageTypes: ['index'] }
    },
  })
  box.send({ type: 'start', resume: false })
  box.send({ type: 'user_message', text: 'Make the header green' })
  const approval = await waitFor(box.messages, 'approval_request')
  assert.equal(approval.files[0].path, 'config/settings_data.json')
  assert.match(approval.files[0].description, /theme editor settings/)
  box.send({ type: 'approval', requestId: approval.requestId, decision: 'decline' })
  const step = await waitFor(box.messages, 'step_result')
  assert.equal(step.summary, 'I left your theme settings alone.')
  assert.deepEqual(step.sensitiveApproved, [])
  assert.equal(decision.behavior, 'deny')
  assert.match(decision.message, /declined/)
  await box.cleanup()
})

test('approving a sensitive file lets the edit proceed and a second edit does not ask', async () => {
  const box = harness({
    async runTurn(ctx) {
      const first = await ctx.hooks.canUseTool('Write', { file_path: '/workspace/config/settings_data.json' })
      const second = await ctx.hooks.canUseTool('Edit', { file_path: '/workspace/config/settings_data.json' })
      return { sessionId: SESSION, summary: `${first.behavior} ${second.behavior}`, warnings: [], pageTypes: [] }
    },
  })
  box.send({ type: 'start', resume: false })
  box.send({ type: 'user_message', text: 'Change the colors' })
  const approval = await waitFor(box.messages, 'approval_request')
  box.send({ type: 'approval', requestId: approval.requestId, decision: 'approve' })
  const step = await waitFor(box.messages, 'step_result')
  assert.equal(step.summary, 'allow allow')
  assert.deepEqual(step.sensitiveApproved, ['config/settings_data.json'])
  assert.equal(box.messages.filter((message) => message.type === 'approval_request').length, 1)
  await box.cleanup()
})

test('blocked files, escapes, and shell tools are denied without a pop-up', async () => {
  const box = harness({
    async runTurn(ctx) {
      const blocked = await ctx.hooks.canUseTool('Write', { file_path: '/workspace/layout/checkout.liquid' })
      const escaped = await ctx.hooks.canUseTool('Read', { file_path: '/etc/passwd' })
      const shell = await ctx.hooks.canUseTool('Bash', { command: 'id' })
      return { sessionId: SESSION, summary: `${blocked.behavior} ${escaped.behavior} ${shell.behavior}`, warnings: [], pageTypes: [] }
    },
  })
  box.send({ type: 'start', resume: false })
  box.send({ type: 'user_message', text: 'Edit checkout' })
  const step = await waitFor(box.messages, 'step_result')
  assert.equal(step.summary, 'deny deny deny')
  assert.equal(box.messages.some((message) => message.type === 'approval_request'), false)
  await box.cleanup()
})

test('a question round-trips and the step clock can be resumed', async () => {
  const box = harness({
    async runTurn(ctx) {
      const answer = await ctx.hooks.ask('Which color?')
      return { sessionId: SESSION, summary: `You chose ${answer}.`, warnings: [], pageTypes: ['index'] }
    },
  })
  box.send({ type: 'start', resume: false })
  box.send({ type: 'user_message', text: 'Recolor the announcement bar' })
  const question = await waitFor(box.messages, 'question')
  assert.equal(question.text, 'Which color?')
  box.send({ type: 'question_answer', requestId: question.requestId, text: 'green' })
  const step = await waitFor(box.messages, 'step_result')
  assert.equal(step.summary, 'You chose green.')
  await box.cleanup()
})

test('only two repair attempts run, and the third is refused', async () => {
  let calls = 0
  const box = harness({
    async runTurn() {
      calls += 1
      return { sessionId: SESSION, summary: `call ${calls}`, warnings: [], pageTypes: [] }
    },
  })
  const problem = { file: 'sections/hero.liquid', check: 'Liquid syntax', message: 'Unknown tag.' }
  box.send({ type: 'start', resume: false })
  box.send({ type: 'user_message', text: 'Add a banner' })
  await waitFor(box.messages, 'step_result', 1)
  box.send({ type: 'repair', problems: [problem] })
  await waitFor(box.messages, 'step_result', 2)
  box.send({ type: 'repair', problems: [problem] })
  await waitFor(box.messages, 'step_result', 3)
  box.send({ type: 'repair', problems: [problem] })
  const error = await waitFor(box.messages, 'error')
  assert.match(error.message, /hasn't changed/)
  assert.equal(calls, 3)
  const repairing = box.messages.filter((message) => message.type === 'progress' && message.stage === 'repairing')
  assert.equal(repairing.length, 2)
  await box.cleanup()
})

test('a step that ignores the clock is stopped', async () => {
  const box = harness(
    {
      async runTurn(ctx) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 10_000)
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(Object.assign(new Error('timeout'), { code: 'timeout' }))
          })
        })
      },
    },
    { stepTimeoutMs: 40 },
  )
  box.send({ type: 'start', resume: false })
  box.send({ type: 'user_message', text: 'Take forever' })
  const error = await waitFor(box.messages, 'error')
  assert.equal(error.code, 'timeout')
  await box.cleanup()
})

test('a step that runs out of turns says so instead of a generic failure', async () => {
  let maxTurns = 0
  const box = harness({
    async runTurn(ctx) {
      maxTurns = ctx.maxTurns
      throw Object.assign(new Error('max_turns'), { code: 'max_turns' })
    },
  })
  box.send({ type: 'start', resume: false })
  box.send({ type: 'user_message', text: 'Rebuild the whole homepage' })
  const error = await waitFor(box.messages, 'error')
  assert.equal(error.code, 'model')
  assert.match(error.message, /more steps than I can take/)
  assert.equal(maxTurns, 32)
  assert.equal(box.messages.some((message) => message.type === 'step_result'), false)
  await box.cleanup()
})

test('cancel stops the turn without a step result', async () => {
  const box = harness({
    async runTurn(ctx) {
      await new Promise((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })))
      })
    },
  })
  box.send({ type: 'start', resume: false })
  box.send({ type: 'user_message', text: 'Start something' })
  await waitFor(box.messages, 'progress')
  box.send({ type: 'cancel' })
  await box.state.then((value) => value.engine.finished)
  assert.equal(box.messages.some((message) => message.type === 'step_result'), false)
  await box.cleanup()
})

test('malformed input is reported and a later message can still run', async () => {
  const box = harness(echo)
  box.send({ type: 'start', resume: false })
  box.input.write('not-json\n')
  const error = await waitFor(box.messages, 'error')
  assert.equal(error.code, 'malformed')
  box.send({ type: 'user_message', text: 'Try again' })
  const step = await waitFor(box.messages, 'step_result')
  assert.equal(step.summary, 'Done.')
  await box.cleanup()
})

test('resume reloads the sdk session id from agent state', async () => {
  const first = harness({
    async runTurn() {
      return { sessionId: SESSION, summary: 'Done.', warnings: [], pageTypes: [] }
    },
  })
  first.send({ type: 'start', resume: false })
  first.send({ type: 'user_message', text: 'Hi' })
  await waitFor(first.messages, 'step_result')
  first.input.end()
  const { dir } = await first.state
  await first.state.then((value) => value.engine.finished)

  const input = new PassThrough()
  const messages = []
  let seen = null
  const engine = runEngine({
    input,
    send: (message) => messages.push(message),
    runtime: {
      async runTurn(ctx) {
        seen = ctx.resumeSessionId
        return { sessionId: SESSION, summary: 'Again.', warnings: [], pageTypes: [] }
      },
    },
    policy,
    workspaceRoot: '/workspace',
    agentStateDir: dir,
    systemPrompt: 'test',
  })
  input.write(JSON.stringify({ type: 'start', resume: true }) + '\n')
  input.write(JSON.stringify({ type: 'user_message', text: 'Continue' }) + '\n')
  await waitFor(messages, 'step_result')
  assert.equal(seen, SESSION)
  input.end()
  await engine.finished
  await rm(dir, { recursive: true, force: true })
})

test('a message carries the page outline and the screenshot; a repair does not', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-engine-ws-'))
  await mkdir(path.join(workspace, 'templates'))
  await writeFile(
    path.join(workspace, 'templates', 'index.json'),
    JSON.stringify({ sections: { a: { type: 'rich-text' } }, order: ['a'] }),
  )
  const dir = await mkdtemp(path.join(tmpdir(), 'sb-engine-'))
  const turns = []
  const input = new PassThrough()
  const messages = []
  const engine = runEngine({
    input,
    send: (message) => messages.push(message),
    runtime: {
      async runTurn(ctx) {
        turns.push({ prompt: ctx.prompt, image: ctx.image })
        return { sessionId: SESSION, summary: 'Done.', warnings: [], pageTypes: [] }
      },
    },
    policy,
    workspaceRoot: workspace,
    agentStateDir: dir,
    systemPrompt: 'test',
  })
  const image = { mediaType: 'image/jpeg', data: 'aGVsbG8=' }
  const write = (message) => input.write(JSON.stringify(message) + '\n')
  write({ type: 'start', resume: false })
  write({ type: 'user_message', text: 'Move it up', image })
  await waitFor(messages, 'step_result', 1)
  write({ type: 'repair', problems: [{ file: 'templates/index.json', check: 'JsonParse', message: 'Bad JSON.' }] })
  await waitFor(messages, 'step_result', 2)
  write({ type: 'user_message', text: 'Bigger', image: { mediaType: 'image/gif', data: 'aGVsbG8=' } })
  const error = await waitFor(messages, 'error')

  assert.equal(error.code, 'protocol')
  assert.equal(turns.length, 2)
  assert.deepEqual(turns[0].image, image)
  assert.match(turns[0].prompt, /^<screenshot>The attached image is the homepage[^<]*<\/screenshot>\n\n<page_outline>\n/)
  assert.match(turns[0].prompt, /1\. "rich-text" · type rich-text · id a/)
  assert.match(turns[0].prompt, /<\/page_outline>\n\n<merchant_request>\nMove it up\n<\/merchant_request>$/)
  assert.equal(turns[1].image, null)
  assert.match(turns[1].prompt, /^Theme Check found new blocking problems/)
  input.end()
  await engine.finished
  await rm(dir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
})

test('the system prompt lists the rules and does not invite a shell', () => {
  const prompt = buildSystemPrompt('Make a small change.', policy, '# Context the app sends')
  assert.match(prompt, /Make a small change\.\n\n# Context the app sends\n\nAllowed theme paths/)
  assert.doesNotMatch(buildSystemPrompt('Make a small change.', policy), /\n\n\n/)
  assert.match(prompt, /assets\/\*\*/)
  assert.match(prompt, /layout\/checkout\.liquid/)
  assert.match(prompt, /Do not run shell commands/)
  assert.match(prompt, /CLAUDE\.md/)
})
