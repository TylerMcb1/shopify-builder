import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_NETWORK_NAME,
  agentContainerName,
  buildAgentKillArgs,
  buildAgentNetworkCreateArgs,
  buildAgentNetworkInspectArgs,
  buildAgentRunArgs,
  interpretAgentNetwork,
} from '../../src/agent/run-args.ts'

const spec = {
  image: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  containerName: 'sb-agent-session-1',
  workspaceHostPath: '/data/stores/shop/sessions/session-1/workspace',
  agentStateHostPath: '/data/stores/shop/sessions/session-1/agent-state',
}

test('agent run arguments match the compose limits and mount only the session', () => {
  const args = buildAgentRunArgs(spec)
  const has = (flag: string, value?: string) => {
    const index = args.indexOf(flag)
    return index !== -1 && (value === undefined || args[index + 1] === value)
  }
  assert.equal(args.filter((arg) => arg === '--network').length, 1)
  assert.ok(has('--network', AGENT_NETWORK_NAME))
  assert.ok(has('--user', '10001:10001'))
  assert.ok(has('--read-only'))
  assert.ok(has('--cap-drop', 'ALL'))
  assert.ok(has('--security-opt', 'no-new-privileges:true'))
  assert.ok(has('--pids-limit', '512'))
  assert.ok(has('--memory', '2g'))
  assert.ok(has('--cpus', '2'))
  assert.ok(has('--rm') && has('-i') && has('--pull', 'never'))
  const labels = args.filter((_, index) => args[index - 1] === '--label')
  assert.deepEqual(labels, ['app=shopify-builder', 'role=agent'])
  assert.equal(args.includes('-e'), false)
  assert.equal(args.includes('--env'), false)
  assert.equal(args.includes('-v'), false)
  assert.equal(args.includes('--privileged'), false)
  assert.equal(args.join('\n').includes('docker.sock'), false)
  assert.equal(args.join('\n').includes('ANTHROPIC'), false)
  assert.equal(args.join('\n').includes('canonical'), false)
  assert.equal(args.join('\n').includes('/inbox'), false)
  const mounts = args.filter((_, index) => args[index - 1] === '--mount')
  assert.deepEqual(mounts, [
    'type=bind,source=/data/stores/shop/sessions/session-1/workspace,target=/workspace',
    'type=bind,source=/data/stores/shop/sessions/session-1/agent-state,target=/agent-state',
  ])
  assert.equal(args.at(-1), spec.image)
})

test('mount paths and names that could inject options are rejected', () => {
  for (const workspaceHostPath of ['relative/workspace', '/a,readonly=false', '/a"b', '/a\nb', '/a=b']) {
    assert.throws(() => buildAgentRunArgs({ ...spec, workspaceHostPath }))
  }
  assert.throws(() => buildAgentRunArgs({ ...spec, containerName: '--privileged' }))
  assert.throws(() => buildAgentRunArgs({ ...spec, image: 'image with spaces' }))
  assert.throws(() => agentContainerName('../etc'))
  assert.equal(agentContainerName('session-1'), 'sb-agent-session-1')
})

test('the agent network is internal and is the only one the run arguments accept', () => {
  assert.deepEqual(buildAgentNetworkCreateArgs(), [
    'network',
    'create',
    '--internal',
    '--label',
    'app=shopify-builder',
    AGENT_NETWORK_NAME,
  ])
  assert.throws(() => buildAgentNetworkCreateArgs('bridge'))
  assert.deepEqual(buildAgentNetworkInspectArgs(), ['network', 'inspect', '--format', '{{.Internal}}', AGENT_NETWORK_NAME])
  assert.equal(interpretAgentNetwork(0, 'true\n'), 'ready')
  assert.equal(interpretAgentNetwork(0, 'false\n'), 'not-internal')
  assert.equal(interpretAgentNetwork(1, ''), 'missing')
  assert.deepEqual(buildAgentKillArgs('sb-agent-session-1'), ['kill', 'sb-agent-session-1'])
  assert.throws(() => buildAgentKillArgs('kill;id'))
})
