// Phase 4 and 5: a real agent process, real Git, and fakes for Theme Check and Shopify push.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentSession, type AgentSession } from '../../src/agent/session.ts'
import { SessionEventSchema, type SessionEvent } from '../../src/agent/protocol.ts'
import { CHANGE_MESSAGES } from '../../src/change/messages.ts'
import { createChangeLoop } from '../../src/change/loop.ts'
import { HostError } from '../../src/errors.ts'
import { createGit } from '../../src/git/git.ts'
import { createHistoryService, type SyncResult } from '../../src/git/history.ts'
import { createSessionHistory } from '../../src/git/session.ts'
import { openRecords } from '../../src/records/store.ts'
import { createWriteGateway } from '../../src/shopify/gateway.ts'
import { type Theme } from '../../src/shopify/schemas.ts'

const runner = fileURLToPath(new URL('../../../../containers/agent/src/runner.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../../../../containers/agent/test/fixtures/runtime.mjs', import.meta.url))
const policyDir = fileURLToPath(new URL('../../../../containers/agent/policy/', import.meta.url))
const SESSION = '11111111-1111-4111-8111-111111111111'
const STORE = 'store-1'
const THEME_ID = 222
const DOMAIN = 'example.myshopify.com'
const working: Theme = { id: THEME_ID, name: 'Working', role: 'unpublished' }

const FILES = {
  'layout/theme.liquid': '<html>{{ content_for_layout }}</html>\n',
  'sections/hero.liquid': 'hello\n',
  'config/settings_data.json': '{"current":"Default"}\n',
}

async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await once(child, 'exit')
}

async function waitFor<T extends SessionEvent['type']>(events: SessionEvent[], type: T, n = 1): Promise<Extract<SessionEvent, { type: T }>> {
  const start = Date.now()
  while (Date.now() - start < 8000) {
    const found = events.filter((event) => event.type === type)
    if (found.length >= n) return found[n - 1] as Extract<SessionEvent, { type: T }>
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error(`timed out waiting for ${type} #${n}: ${JSON.stringify(events.map((event) => event.type))}`)
}

async function seed() {
  const dir = await mkdtemp(path.join(tmpdir(), 'sb-change-'))
  const userData = path.join(dir, 'user')
  const git = await createGit(userData)
  const history = createHistoryService(git)
  const sessions = createSessionHistory(git)
  const gitDir = path.join(dir, 'history.git')
  const treeDir = path.join(dir, 'tree')
  for (const [rel, content] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(treeDir, rel)), { recursive: true })
    await writeFile(path.join(treeDir, rel), content)
  }
  const sync = await history.recordSync({
    gitDir,
    treeDir,
    files: Object.keys(FILES),
    source: { id: THEME_ID, role: 'unpublished' },
  })
  const canonical = path.join(dir, 'canonical')
  const workspace = path.join(dir, 'workspace')
  await sessions.materialize(gitDir, sync.commit, canonical)
  await sessions.materialize(gitDir, sync.commit, workspace)
  const records = openRecords(userData)
  records.saveOwnership({
    storeId: STORE,
    themeId: THEME_ID,
    kind: 'working-copy',
    name: 'Working',
    originThemeId: null,
    retired: false,
  })
  const branch = await sessions.ensureBranch(gitDir, SESSION)
  return { dir, userData, git, history, sessions, gitDir, canonical, workspace, base: branch.commit, records }
}

function themeCheck(dir: string) {
  return readFile(path.join(dir, 'sections/hero.liquid'), 'utf8').then((hero) =>
    hero.includes('broken')
      ? [{ check: 'SyntaxError', file: 'sections/hero.liquid', message: 'Liquid did not parse.', severity: 'error' as const }]
      : [],
  )
}

test('a broken step is repaired, checked, and saved without a live push', async () => {
  const box = await seed()
  const events: SessionEvent[] = []
  const failures: unknown[] = []
  const pushes: string[][] = []
  const shots: string[] = []
  let child: ChildProcess | undefined
  const writer = createWriteGateway({
    storeId: STORE,
    storeDomain: DOMAIN,
    records: box.records,
    listThemes: async () => [working],
    runPush: async (args) => {
      pushes.push([...args])
      return JSON.stringify({ theme: working, preview_url: 'https://evil.example/preview' })
    },
  })
  let loop!: ReturnType<typeof createChangeLoop>
  const session = createAgentSession({
    sessionId: SESSION,
    stepTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    readyTimeoutMs: 3000,
    startProcess: () => {
      child = spawn(process.execPath, [runner], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          TMPDIR: box.dir,
          AGENT_TEST_RUNTIME: '1',
          AGENT_RUNTIME_MODULE: fixture,
          AGENT_SCENARIO: 'theme-step',
          POLICY_DIR: policyDir,
          WORKSPACE_DIR: box.workspace,
          AGENT_STATE_DIR: path.join(box.dir, 'agent-state'),
        },
      })
      return child
    },
    onEvent: (event) => {
      if (event.type === 'step_result') {
        void loop.afterStep(event).catch((err) => failures.push(err))
        return
      }
      events.push(event)
    },
  })
  loop = createChangeLoop({
    storeId: STORE,
    themeId: THEME_ID,
    storeDomain: DOMAIN,
    sessionId: SESSION,
    workspace: box.workspace,
    canonical: box.canonical,
    gitDir: box.gitDir,
    baseCommit: box.base,
    send: (event) => events.push(event),
    session,
    history: box.sessions,
    records: box.records,
    ports: {
      runThemeCheck: themeCheck,
      syncTheme: async () => ({ created: false, commit: box.base, parent: null, tag: null, title: null, changes: [] }),
      pushPreview: async () => 333,
      pushSave: (files, treeDir) => writer.pushSavedFiles(THEME_ID, treeDir, files),
      capture: async (_pages, when) => {
        shots.push(when)
      },
    },
  })
  try {
    await mkdir(path.join(box.dir, 'agent-state'), { recursive: true })
    await session.ready
    await loop.preparePreview()
    loop.noteUserMessage('Make the hero larger')
    assert.equal(session.sendUserMessage('Make the hero larger').ok, true)
    const ready = await waitFor(events, 'step_ready')
    assert.equal(ready.summary, 'Fixed the hero.')
    assert.deepEqual(
      ready.files.map((file) => file.path),
      ['sections/hero.liquid'],
    )
    const preview = events.filter((event) => event.type === 'preview_ready').at(-1)
    assert.ok(preview && preview.type === 'preview_ready')
    assert.deepEqual(preview.pages, ['index'])
    assert.equal(preview.previewThemeId, 333)
    assert.ok(events.some((event) => event.type === 'progress' && event.stage === 'repairing'))
    assert.deepEqual(shots, ['before', 'after'])
    const saved = await loop.save()
    assert.equal(saved.status, 'saved')
    assert.equal(saved.ok, true)
    const savedEvent = await waitFor(events, 'saved')
    assert.equal(savedEvent.themeName, 'Working')
    assert.equal(savedEvent.title, 'Make the hero larger')
    assert.equal(pushes.length, 1)
    const args = pushes[0] ?? []
    assert.ok(args.includes('--nodelete'))
    assert.ok(args.includes('--only'))
    assert.ok(args.includes('sections/hero.liquid'))
    for (const banned of ['--allow-live', '--live', '--publish', '--delete', '-d', '-l', '-a', '-p']) {
      assert.equal(args.includes(banned), false, banned)
    }
    assert.equal(await readFile(path.join(box.canonical, 'sections/hero.liquid'), 'utf8'), 'hello fixed\n')
    assert.match(await gitLog(box.git, box.gitDir), /^change: Make the hero larger/)
    assert.equal(await box.sessions.tip(box.gitDir, `refs/heads/session/${SESSION}`), null)
    assert.equal(box.records.getChange(savedEvent.changeId)?.title, 'Make the hero larger')
    assert.deepEqual(failures, [])
  } finally {
    session.cancel()
    if (child) await exited(child).catch(() => undefined)
    await rm(box.dir, { recursive: true, force: true })
  }
})

test('two repairs that still fail restore the theme and do not save it', async () => {
  const box = await seed()
  const events: SessionEvent[] = []
  let pushes = 0
  let child: ChildProcess | undefined
  let loop!: ReturnType<typeof createChangeLoop>
  const session = createAgentSession({
    sessionId: SESSION,
    stepTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    readyTimeoutMs: 3000,
    startProcess: () => {
      child = spawn(process.execPath, [runner], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          TMPDIR: box.dir,
          AGENT_TEST_RUNTIME: '1',
          AGENT_RUNTIME_MODULE: fixture,
          AGENT_SCENARIO: 'always-broken',
          POLICY_DIR: policyDir,
          WORKSPACE_DIR: box.workspace,
          AGENT_STATE_DIR: path.join(box.dir, 'agent-state'),
        },
      })
      return child
    },
    onEvent: (event) => {
      if (event.type === 'step_result') {
        void loop.afterStep(event)
        return
      }
      events.push(event)
    },
  })
  loop = createChangeLoop({
    storeId: STORE,
    themeId: THEME_ID,
    storeDomain: DOMAIN,
    sessionId: SESSION,
    workspace: box.workspace,
    canonical: box.canonical,
    gitDir: box.gitDir,
    baseCommit: box.base,
    send: (event) => events.push(event),
    session,
    history: box.sessions,
    records: box.records,
    ports: {
      runThemeCheck: themeCheck,
      syncTheme: async () => ({ created: false, commit: box.base, parent: null, tag: null, title: null, changes: [] }),
      pushPreview: async () => 333,
      pushSave: async () => {
        pushes += 1
        return working
      },
    },
  })
  try {
    await mkdir(path.join(box.dir, 'agent-state'), { recursive: true })
    await session.ready
    assert.equal(loop.retry().ok, false)
    loop.noteUserMessage('Break the hero')
    assert.equal(session.sendUserMessage('Break the hero').ok, true)
    const blocked = await waitFor(events, 'validation_blocked')
    assert.equal(blocked.message, CHANGE_MESSAGES.blocked)
    assert.equal(blocked.canRetry, true)
    assert.equal(await readFile(path.join(box.canonical, 'sections/hero.liquid'), 'utf8'), 'hello\n')
    assert.equal(await readFile(path.join(box.workspace, 'sections/hero.liquid'), 'utf8'), 'hello\n')
    assert.equal((await loop.save()).status, 'blocked')
    assert.equal(pushes, 0)
  } finally {
    session.cancel()
    if (child) await exited(child).catch(() => undefined)
    await rm(box.dir, { recursive: true, force: true })
  }
})

test('declining an unapproved sensitive edit puts the original file back', async () => {
  const box = await seed()
  const events: SessionEvent[] = []
  let child: ChildProcess | undefined
  let loop!: ReturnType<typeof createChangeLoop>
  const session = createAgentSession({
    sessionId: SESSION,
    stepTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    readyTimeoutMs: 3000,
    startProcess: () => {
      child = spawn(process.execPath, [runner], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          TMPDIR: box.dir,
          AGENT_TEST_RUNTIME: '1',
          AGENT_RUNTIME_MODULE: fixture,
          AGENT_SCENARIO: 'settings-backstop',
          POLICY_DIR: policyDir,
          WORKSPACE_DIR: box.workspace,
          AGENT_STATE_DIR: path.join(box.dir, 'agent-state'),
        },
      })
      return child
    },
    onEvent: (event) => {
      if (event.type === 'step_result') {
        void loop.afterStep(event)
        return
      }
      events.push(event)
    },
  })
  loop = createChangeLoop({
    storeId: STORE,
    themeId: THEME_ID,
    storeDomain: DOMAIN,
    sessionId: SESSION,
    workspace: box.workspace,
    canonical: box.canonical,
    gitDir: box.gitDir,
    baseCommit: box.base,
    send: (event) => {
      events.push(event)
      if (event.type === 'approval_request') loop.decideApproval(event.requestId, 'decline')
    },
    session,
    history: box.sessions,
    records: box.records,
    ports: {
      runThemeCheck: async () => [],
      syncTheme: async () => ({ created: false, commit: box.base, parent: null, tag: null, title: null, changes: [] }),
      pushPreview: async () => 333,
      pushSave: async () => working,
    },
  })
  try {
    await mkdir(path.join(box.dir, 'agent-state'), { recursive: true })
    await session.ready
    assert.equal(session.sendUserMessage('Change the colors').ok, true)
    const ready = await waitFor(events, 'step_ready')
    assert.deepEqual(ready.files, [])
    assert.match(ready.warnings.join('\n'), /declined changes to important files/)
    const approval = events.find((event) => event.type === 'approval_request')
    assert.ok(approval && approval.type === 'approval_request')
    assert.equal(approval.files[0]?.path, 'config/settings_data.json')
    assert.equal(await readFile(path.join(box.canonical, 'config/settings_data.json'), 'utf8'), FILES['config/settings_data.json'])
    assert.equal(await readFile(path.join(box.workspace, 'config/settings_data.json'), 'utf8'), FILES['config/settings_data.json'])
  } finally {
    session.cancel()
    if (child) await exited(child).catch(() => undefined)
    await rm(box.dir, { recursive: true, force: true })
  }
})

test('overlapping Shopify edits that cannot merge do not push', async () => {
  const box = await seed()
  const events: SessionEvent[] = []
  let pushes = 0
  let sync: SyncResult = { created: false, commit: box.base, parent: null, tag: null, title: null, changes: [] }
  const session = stubSession()
  const loop = createChangeLoop({
    storeId: STORE,
    themeId: THEME_ID,
    storeDomain: DOMAIN,
    sessionId: SESSION,
    workspace: box.workspace,
    canonical: box.canonical,
    gitDir: box.gitDir,
    baseCommit: box.base,
    send: (event) => events.push(event),
    session,
    history: box.sessions,
    records: box.records,
    ports: {
      runThemeCheck: async () => [],
      syncTheme: async () => sync,
      pushPreview: async () => 333,
      pushSave: async () => {
        pushes += 1
        return working
      },
    },
  })
  try {
    await writeFile(path.join(box.workspace, 'sections/hero.liquid'), 'from session\n')
    await loop.afterStep(step('Updated the hero.'))
    await waitFor(events, 'step_ready')
    const treeDir = path.join(box.dir, 'remote')
    for (const [rel, content] of Object.entries({ ...FILES, 'sections/hero.liquid': 'from shopify\n' })) {
      await mkdir(path.dirname(path.join(treeDir, rel)), { recursive: true })
      await writeFile(path.join(treeDir, rel), content)
    }
    const remote = await box.history.recordSync({
      gitDir: box.gitDir,
      treeDir,
      files: Object.keys(FILES),
      source: { id: THEME_ID, role: 'unpublished' },
    })
    sync = remote
    const saved = await loop.save()
    assert.equal(saved.status, 'conflict')
    assert.equal(saved.message, CHANGE_MESSAGES.driftConflict)
    assert.equal(pushes, 0)
    assert.equal(box.records.getJob(`${STORE}:${THEME_ID}`), null)
    const undone = await loop.undoStep()
    assert.equal(undone.message, CHANGE_MESSAGES.stepUndone)
    assert.ok(events.some((event) => event.type === 'step_undone'))
    assert.equal(await readFile(path.join(box.canonical, 'sections/hero.liquid'), 'utf8'), 'hello\n')
    assert.equal((await loop.undoStep()).message, CHANGE_MESSAGES.nothingToUndo)
    const fresh = await loop.redoOnLatest()
    assert.equal(fresh.message, CHANGE_MESSAGES.startedOver)
    assert.ok(events.some((event) => event.type === 'steps_cleared'))
    assert.equal(await readFile(path.join(box.canonical, 'sections/hero.liquid'), 'utf8'), 'from shopify\n')
    await loop.discard()
    assert.ok(events.some((event) => event.type === 'discarded'))
  } finally {
    await rm(box.dir, { recursive: true, force: true })
  }
})

test('a theme check that crashes rolls the step back and offers to try again', async () => {
  const box = await seed()
  const events: SessionEvent[] = []
  const logs: string[] = []
  const sent: string[] = []
  const session = { ...stubSession(), sendUserMessage: (text: string) => (sent.push(text), { ok: true }) }
  const loop = createChangeLoop({
    storeId: STORE,
    themeId: THEME_ID,
    storeDomain: DOMAIN,
    sessionId: SESSION,
    workspace: box.workspace,
    canonical: box.canonical,
    gitDir: box.gitDir,
    baseCommit: box.base,
    send: (event) => events.push(event),
    session,
    history: box.sessions,
    records: box.records,
    log: (text) => logs.push(text),
    ports: {
      runThemeCheck: async () => {
        throw new HostError('invalid-output', "Couldn't read the theme check result.", 'bad json')
      },
      syncTheme: async () => ({ created: false, commit: box.base, parent: null, tag: null, title: null, changes: [] }),
      pushPreview: async () => 333,
      pushSave: async () => working,
    },
  })
  try {
    loop.noteUserMessage('Add a heading')
    await writeFile(path.join(box.workspace, 'sections/hero.liquid'), 'from session\n')
    await loop.afterStep(step('Added a heading.'))
    const blocked = await waitFor(events, 'validation_blocked')
    assert.equal(blocked.message, CHANGE_MESSAGES.stepFailed)
    assert.equal(blocked.canRetry, true)
    assert.match(logs.join('\n'), /invalid-output.*bad json/)
    assert.equal(await readFile(path.join(box.workspace, 'sections/hero.liquid'), 'utf8'), 'hello\n')
    assert.equal((await loop.undoStep()).message, CHANGE_MESSAGES.nothingToUndo)
    assert.equal(loop.retry().ok, true)
    assert.match(sent.at(-1) ?? '', /Add a heading$/)
  } finally {
    await rm(box.dir, { recursive: true, force: true })
  }
})

function step(summary: string): Extract<SessionEvent, { type: 'step_result' }> {
  return SessionEventSchema.parse({
    sessionId: SESSION,
    seq: 1,
    type: 'step_result',
    summary,
    warnings: [],
    pageTypes: ['index', 'product'],
    sensitiveApproved: [],
  }) as Extract<SessionEvent, { type: 'step_result' }>
}

function stubSession(): AgentSession {
  return {
    id: SESSION,
    ready: Promise.resolve(),
    sendUserMessage: () => ({ ok: true }),
    requestRepair: () => ({ ok: false, message: CHANGE_MESSAGES.blocked }),
    decideApproval: () => ({ ok: true }),
    answerQuestion: () => ({ ok: true }),
    cancel: () => undefined,
  }
}

async function gitLog(git: Awaited<ReturnType<typeof createGit>>, gitDir: string): Promise<string> {
  return (await git.run(gitDir, ['log', '-1', '--format=%s', 'refs/heads/shopify'])).stdout.toString('utf8').trim()
}
