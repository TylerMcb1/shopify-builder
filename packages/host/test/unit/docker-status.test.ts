import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dockerExec } from '../../src/docker/exec.ts'
import {
  checkDockerDesktop,
  compareVersions,
  DOCKER_MESSAGES,
  interpretDockerVersion,
} from '../../src/docker/status.ts'

const version = (server: unknown) => JSON.stringify({ Client: { Version: '27.0.0' }, Server: server })

test('compareVersions orders dotted numeric versions', () => {
  assert.equal(compareVersions('24.0.0', '24.0.0'), 0)
  assert.equal(compareVersions('24.0.1', '24.0.0'), 1)
  assert.equal(compareVersions('23.9.9', '24.0.0'), -1)
})

test('a Linux engine at the minimum version is ready', () => {
  const status = interpretDockerVersion(
    { exitCode: 0, stdout: version({ Version: '27.1.1', Os: 'linux' }), stderr: '' },
    '24.0.0',
  )
  assert.equal(status.state, 'ready')
  assert.equal(status.message, DOCKER_MESSAGES.ready)
  assert.equal(status.version, '27.1.1')
  assert.equal(status.os, 'linux')
})

test('engine suffixes still count, and older or Windows engines do not', () => {
  assert.equal(
    interpretDockerVersion(
      { exitCode: 0, stdout: version({ Version: '24.0.0-rd', Os: 'linux' }), stderr: '' },
      '24.0.0',
    ).state,
    'ready',
  )
  const old = interpretDockerVersion(
    { exitCode: 0, stdout: version({ Version: '23.0.1', Os: 'linux' }), stderr: '' },
    '24.0.0',
  )
  assert.equal(old.state, 'too-old')
  assert.equal(old.message, DOCKER_MESSAGES.update)
  const windows = interpretDockerVersion(
    { exitCode: 0, stdout: version({ Version: '27.0.0', Os: 'windows' }), stderr: '' },
    '24.0.0',
  )
  assert.equal(windows.state, 'windows-containers')
  assert.equal(windows.message, DOCKER_MESSAGES.switchLinux)
})

test('a missing daemon, bad output, or missing binary is a plain-language status', () => {
  assert.equal(
    interpretDockerVersion({ exitCode: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' }, '24.0.0').state,
    'not-running',
  )
  assert.equal(
    interpretDockerVersion({ exitCode: 1, stdout: version(null), stderr: '' }, '24.0.0').message,
    DOCKER_MESSAGES.open,
  )
  assert.equal(interpretDockerVersion({ exitCode: 1, stdout: 'not-json', stderr: '' }, '24.0.0').state, 'unavailable')
  assert.equal(
    interpretDockerVersion({ exitCode: 1, stdout: '', stderr: '', spawnError: 'ENOENT' }, '24.0.0').message,
    DOCKER_MESSAGES.install,
  )
  assert.equal(
    interpretDockerVersion({ exitCode: 0, stdout: version({ Version: '27.0.0', Os: 'linux' }), stderr: '' }, 'latest')
      .state,
    'unavailable',
  )
})

test('checkDockerDesktop asks docker version as an argument array', async () => {
  let seen: readonly string[] = []
  const status = await checkDockerDesktop({
    minimumVersion: '24.0.0',
    run: async (args) => {
      seen = args
      return { exitCode: 0, stdout: version({ Version: '28.0.0', Os: 'linux' }), stderr: '', spawnError: null }
    },
  })
  assert.deepEqual(seen, ['version', '--format', '{{json .}}'])
  assert.equal(status.state, 'ready')
})

test('dockerExec does not use a shell and reports a missing binary and a timeout', async () => {
  const ok = await dockerExec(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'a b'])
  assert.equal(ok.exitCode, 0)
  assert.equal(ok.stdout, 'a b')
  assert.equal(ok.spawnError, null)

  const missing = await dockerExec('definitely-missing-docker-binary', ['version'])
  assert.equal(missing.spawnError, 'ENOENT')

  const timed = await dockerExec(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 200 })
  assert.equal(timed.stderr, 'timed out')
})
