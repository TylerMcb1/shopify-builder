// Owns one agent process: validates its stdout, records approvals, and stops it (README 6.2, 10.4).
import { type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { containsCredential } from '../redact.ts'
import { presentProgress, presentStep, presentText, reviewApprovalRequest } from './present.ts'
import {
  AGENT_IDLE_TIMEOUT_MS,
  AGENT_MAX_REPAIRS,
  AGENT_READY_TIMEOUT_MS,
  AGENT_STEP_TIMEOUT_MS,
  HostToRunnerSchema,
  RunnerMessageSchema,
  SESSION_MESSAGES,
  SessionEventSchema,
  type HostToRunner,
  type SessionBody,
  type SessionCommandResult,
  type SessionEvent,
} from './protocol.ts'

export interface AgentSession {
  readonly id: string
  readonly ready: Promise<void>
  sendUserMessage(text: string): SessionCommandResult
  requestRepair(problems: unknown): SessionCommandResult
  decideApproval(requestId: string, decision: 'approve' | 'decline'): SessionCommandResult
  answerQuestion(requestId: string, text: string): SessionCommandResult
  cancel(): void
}

export function createAgentSession(opts: {
  sessionId: string
  startProcess: () => ChildProcess
  onEvent: (event: SessionEvent) => void
  resume?: boolean
  stepTimeoutMs?: number
  idleTimeoutMs?: number
  readyTimeoutMs?: number
  /** Extra stop, for example `docker kill`. The child is always killed too. */
  stop?: () => void
  /** Why the session ended, for the main-process log. Never includes message contents. */
  onDiagnostic?: (text: string) => void
}): AgentSession {
  const stepBudget = opts.stepTimeoutMs ?? AGENT_STEP_TIMEOUT_MS
  const idleBudget = opts.idleTimeoutMs ?? AGENT_IDLE_TIMEOUT_MS
  const child = opts.startProcess()
  let ended = false
  let ready = false
  let turnInFlight = false
  let repairs = 0
  let seq = 0
  let stepRemaining = stepBudget
  let stepStarted = 0
  const stepApproved: string[] = []
  let pending: { kind: 'approval' | 'question'; requestId: string; files: string[] } | null = null
  let stepTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  let readySettled = false
  let resolveReady: () => void = () => {}
  let rejectReady: (err: Error) => void = () => {}
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      if (readySettled) return
      readySettled = true
      resolve()
    }
    rejectReady = (err) => {
      if (readySettled) return
      readySettled = true
      reject(err)
    }
  })
  // The caller may not be awaiting yet when a fast failure rejects this.
  readyPromise.catch(() => {})

  let stderrTail = ''
  const fail = (kind: 'malformed' | 'timeout' | 'idle' | 'cancelled', why?: string) => {
    if (ended) return
    ended = true
    if (why && kind !== 'cancelled') {
      const tail = stderrTail.trim()
      const stderr = tail && !containsCredential(tail) ? `; stderr: ${tail}` : ''
      try {
        opts.onDiagnostic?.(`${why}${stderr}`)
      } catch {
        // Logging must not stop the shutdown.
      }
    }
    clearTimeout(stepTimer)
    clearTimeout(idleTimer)
    clearTimeout(readyTimer)
    const message =
      kind === 'timeout'
        ? SESSION_MESSAGES.timeout
        : kind === 'idle'
          ? SESSION_MESSAGES.idle
          : kind === 'cancelled'
            ? SESSION_MESSAGES.cancelled
            : kind === 'malformed' && !ready
              ? SESSION_MESSAGES.didNotStart
              : SESSION_MESSAGES.malformed
    const code = kind === 'idle' ? 'timeout' : kind === 'malformed' ? 'malformed' : kind
    try {
      emit({ type: 'error', code, message })
    } catch {
      // A failure while reporting the failure still has to stop the process.
    }
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
    try {
      opts.stop?.()
    } catch {
      // docker kill is best-effort.
    }
    rejectReady(new Error(message))
  }

  const emit = (body: SessionBody) => {
    seq += 1
    const event = SessionEventSchema.parse({ sessionId: opts.sessionId, seq, ...body })
    opts.onEvent(event)
  }

  const write = (message: HostToRunner) => {
    if (ended) return
    const line = JSON.stringify(HostToRunnerSchema.parse(message)) + '\n'
    if (!child.stdin || child.stdin.destroyed) return fail('malformed')
    child.stdin.write(line)
    resetIdle()
  }

  const resetIdle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => fail('idle'), idleBudget)
  }

  const startStepTimer = () => {
    clearTimeout(stepTimer)
    stepStarted = Date.now()
    stepTimer = setTimeout(() => fail('timeout'), Math.max(1, stepRemaining))
  }

  const pauseStepTimer = () => {
    if (!stepTimer) return
    clearTimeout(stepTimer)
    stepTimer = undefined
    stepRemaining -= Date.now() - stepStarted
  }

  const beginStepClock = () => {
    stepRemaining = stepBudget
    startStepTimer()
  }

  const clearStep = () => {
    turnInFlight = false
    clearTimeout(stepTimer)
    stepTimer = undefined
  }

  readyTimer = setTimeout(() => fail('malformed', 'no ready message before the timeout'), opts.readyTimeoutMs ?? AGENT_READY_TIMEOUT_MS)
  resetIdle()
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000)
  })
  child.on('error', (err) => fail('malformed', `process error: ${err.message}`))
  child.on('exit', (code, signal) => {
    if (!ended) fail('malformed', `process exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`)
  })

  if (!child.stdout) throw new Error('agent process has no stdout')
  const rl = createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    if (ended) return
    resetIdle()
    if (line.length > 1_000_000) return fail('malformed', 'output line too long')
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      return fail('malformed', 'output line was not JSON')
    }
    const parsed = RunnerMessageSchema.safeParse(raw)
    if (!parsed.success) {
      const type = raw && typeof raw === 'object' && typeof (raw as { type?: unknown }).type === 'string' ? (raw as { type: string }).type : 'unknown'
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
      return fail('malformed', `rejected "${type.slice(0, 40)}" message: ${issues.slice(0, 500)}`)
    }
    onMessage(parsed.data)
  })

  function onMessage(message: ReturnType<typeof RunnerMessageSchema.parse>) {
    if (!ready) {
      if (message.type !== 'ready') return fail('malformed', `expected "ready" first, got "${message.type}"`)
      ready = true
      clearTimeout(readyTimer)
      write({ type: 'start', resume: opts.resume === true })
      resolveReady()
      return
    }
    if (message.type === 'ready') return fail('malformed')
    if (message.type === 'progress') {
      emit({ type: 'progress', ...presentProgress(message.stage) })
      return
    }
    if (message.type === 'assistant') {
      const text = presentText(message.text)
      if (text) emit({ type: 'assistant', text })
      return
    }
    if (message.type === 'approval_request') {
      if (pending) return fail('malformed')
      const review = reviewApprovalRequest(message.files)
      if (review.action === 'decline') {
        write({ type: 'approval', requestId: message.requestId, decision: 'decline' })
        return
      }
      pending = { kind: 'approval', requestId: message.requestId, files: review.files.map((file) => file.path) }
      pauseStepTimer()
      emit({ type: 'approval_request', requestId: message.requestId, files: review.files })
      return
    }
    if (message.type === 'question') {
      if (pending) return fail('malformed')
      const text = presentText(message.text)
      if (!text) {
        write({ type: 'question_answer', requestId: message.requestId, text: 'Please ask that another way.' })
        return
      }
      pending = { kind: 'question', requestId: message.requestId, files: [] }
      pauseStepTimer()
      emit({ type: 'question', requestId: message.requestId, text })
      return
    }
    if (message.type === 'step_result') {
      clearStep()
      emit({ type: 'step_result', ...presentStep(message, stepApproved) })
      return
    }
    if (message.type === 'error') {
      if (message.code === 'model') {
        clearStep()
        const tail = stderrTail.trim()
        stderrTail = ''
        try {
          opts.onDiagnostic?.(`step ended with a model error${tail && !containsCredential(tail) ? `; stderr: ${tail}` : ''}`)
        } catch {
          // Logging must not change the session.
        }
        const text = presentText(message.message) ?? SESSION_MESSAGES.model
        emit({ type: 'error', code: 'model', message: text })
        return
      }
      if (message.code === 'timeout') return fail('timeout')
      if (message.code === 'cancelled') return fail('cancelled')
      return fail('malformed')
    }
  }

  return {
    id: opts.sessionId,
    ready: readyPromise,
    sendUserMessage(text) {
      if (ended) return { ok: false, message: SESSION_MESSAGES.noSession }
      if (!ready) return { ok: false, message: SESSION_MESSAGES.notReady }
      if (turnInFlight || pending) return { ok: false, message: SESSION_MESSAGES.busy }
      if (containsCredential(text)) return { ok: false, message: SESSION_MESSAGES.credential }
      const parsed = HostToRunnerSchema.safeParse({ type: 'user_message', text })
      if (!parsed.success) return { ok: false, message: SESSION_MESSAGES.unexpected }
      repairs = 0
      stepApproved.length = 0
      turnInFlight = true
      write(parsed.data)
      beginStepClock()
      return { ok: true }
    },
    requestRepair(problems) {
      if (ended || !ready) return { ok: false, message: SESSION_MESSAGES.noSession }
      if (turnInFlight || pending) return { ok: false, message: SESSION_MESSAGES.busy }
      if (repairs >= AGENT_MAX_REPAIRS) return { ok: false, message: SESSION_MESSAGES.repairLimit }
      const parsed = HostToRunnerSchema.safeParse({ type: 'repair', problems })
      if (!parsed.success) return { ok: false, message: SESSION_MESSAGES.unexpected }
      repairs += 1
      turnInFlight = true
      write(parsed.data)
      beginStepClock()
      return { ok: true }
    },
    decideApproval(requestId, decision) {
      if (ended || !pending || pending.kind !== 'approval' || pending.requestId !== requestId) {
        return { ok: false, message: SESSION_MESSAGES.unexpected }
      }
      const files = pending.files
      pending = null
      if (decision === 'approve') {
        for (const file of files) if (!stepApproved.includes(file)) stepApproved.push(file)
      }
      write({ type: 'approval', requestId, decision })
      startStepTimer()
      return { ok: true }
    },
    answerQuestion(requestId, text) {
      if (ended || !pending || pending.kind !== 'question' || pending.requestId !== requestId) {
        return { ok: false, message: SESSION_MESSAGES.unexpected }
      }
      const parsed = HostToRunnerSchema.safeParse({ type: 'question_answer', requestId, text })
      if (!parsed.success) return { ok: false, message: SESSION_MESSAGES.unexpected }
      pending = null
      write(parsed.data)
      startStepTimer()
      return { ok: true }
    },
    cancel() {
      if (ended) return
      if (ready && child.stdin && !child.stdin.destroyed) {
        try {
          child.stdin.write(JSON.stringify({ type: 'cancel' }) + '\n')
        } catch {
          // The process is about to be killed anyway.
        }
      }
      fail('cancelled')
    },
  }
}
