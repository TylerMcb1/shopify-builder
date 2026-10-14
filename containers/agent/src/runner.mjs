// Agent container entrypoint (README 6.2). Line-delimited JSON on stdin and stdout.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSystemPrompt, runEngine } from './engine.mjs'
import { loadPolicy } from './permissions.mjs'

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')

const policyDir = process.env.POLICY_DIR || '/app/policy'
const workspaceRoot = process.env.WORKSPACE_DIR || '/workspace'
const agentStateDir = process.env.AGENT_STATE_DIR || '/agent-state'

let policy
let instructions
try {
  policy = loadPolicy(policyDir)
  instructions = readFileSync(path.join(policyDir, 'system-instructions.md'), 'utf8')
} catch {
  send({ type: 'error', code: 'protocol', message: 'The change assistant could not read its rules.' })
  process.exit(1)
}

const testRuntime = process.env.AGENT_TEST_RUNTIME === '1' ? process.env.AGENT_RUNTIME_MODULE : ''
let runtime
try {
  runtime = testRuntime ? await import(pathToFileURL(testRuntime).href) : await import('./claude-runtime.mjs')
} catch {
  send({ type: 'error', code: 'protocol', message: 'The change assistant could not start.' })
  process.exit(1)
}
const limits = {}
if (testRuntime && process.env.STEP_TIMEOUT_MS) {
  const stepTimeoutMs = Number(process.env.STEP_TIMEOUT_MS)
  if (Number.isFinite(stepTimeoutMs) && stepTimeoutMs > 0) limits.stepTimeoutMs = stepTimeoutMs
}

const engine = runEngine({
  input: process.stdin,
  send,
  runtime,
  policy,
  workspaceRoot,
  agentStateDir,
  systemPrompt: buildSystemPrompt(instructions, policy),
  limits,
  onCancel: () => process.exit(0),
})

send({ type: 'ready' })
await engine.finished
await new Promise((resolve) => process.stdout.write('', () => resolve(undefined)))
process.exit(0)
