import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSessionBridge } from '../src/main/session-bridge.ts'
import { SESSION_MESSAGES } from '../../../packages/host/src/agent/protocol.ts'
import { sessionPaths, themePaths } from '../../../packages/host/src/store/layout.ts'

const readyScript = "process.stdout.write(JSON.stringify({type:'ready'})+'\\n'); process.stdin.resume()"

async function seedTheme(root: string): Promise<void> {
  const canonical = themePaths(root, 'shop', 3).canonical
  await mkdir(path.join(canonical, 'sections'), { recursive: true })
  await writeFile(path.join(canonical, 'sections', 'hero.liquid'), 'hello\n')
  await writeFile(path.join(canonical, '.secret'), 'no\n')
}

test('a session copies the theme, refuses a second one, and resume keeps edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sb-bridge-'))
  try {
    await seedTheme(root)
    const bridge = createSessionBridge({
      userDataDir: root,
      image: 'sha256:' + 'a'.repeat(64),
      send: () => {},
      readyTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      stepTimeoutMs: 5000,
      startProcess: () => spawn(process.execPath, ['-e', readyScript], { stdio: ['pipe', 'pipe', 'pipe'] }),
    })

    const missing = await bridge.start({ storeId: 'shop', themeId: 9 })
    assert.equal(missing.ok, false)
    assert.match(missing.message ?? '', /Pull this theme/)

    const bad = await bridge.start({ storeId: '../shop', themeId: 3 })
    assert.equal(bad.ok, false)
    assert.equal(bad.message, SESSION_MESSAGES.unexpected)

    const started = await bridge.start({ storeId: 'shop', themeId: 3 })
    assert.equal(started.ok, true)
    const workspace = sessionPaths(root, 'shop', started.sessionId ?? '').workspace
    assert.equal(await readFile(path.join(workspace, 'sections', 'hero.liquid'), 'utf8'), 'hello\n')
    await assert.rejects(readFile(path.join(workspace, '.secret'), 'utf8'))

    const second = await bridge.start({ storeId: 'shop', themeId: 3 })
    assert.equal(second.ok, false)
    assert.equal(second.message, SESSION_MESSAGES.busy)

    await writeFile(path.join(workspace, 'sections', 'hero.liquid'), 'edited\n')
    const canonical = themePaths(root, 'shop', 3).canonical
    await writeFile(path.join(canonical, 'sections', 'hero.liquid'), 'from shopify\n')
    assert.equal((await bridge.cancel()).ok, true)
    assert.equal((await bridge.sendMessage('hello')).ok, false)

    const resumed = await bridge.start({ storeId: 'shop', themeId: 3, resumeSessionId: started.sessionId })
    assert.equal(resumed.ok, true)
    assert.equal(resumed.sessionId, started.sessionId)
    assert.equal(await readFile(path.join(workspace, 'sections', 'hero.liquid'), 'utf8'), 'edited\n')
    assert.equal((await bridge.cancel()).ok, true)
    assert.equal((await bridge.decideApproval('00000000-0000-4000-8000-000000000001', 'decline')).ok, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
