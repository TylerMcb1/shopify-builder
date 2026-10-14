// `docker run` arguments for one agent container (README 6.2).
// No secrets, no extra mounts, and only the internal network. Must stay in sync with
// the agent service in containers/compose.yaml.
import path from 'node:path'

export const AGENT_NETWORK_NAME = 'shopify-builder-agent-internal'
export const AGENT_WORKSPACE_TARGET = '/workspace'
export const AGENT_STATE_TARGET = '/agent-state'

const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/
const NETWORK_NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/

export interface AgentRunSpec {
  image: string
  containerName: string
  workspaceHostPath: string
  agentStateHostPath: string
}

export function agentContainerName(sessionId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(sessionId)) throw new Error('invalid session id')
  return `sb-agent-${sessionId}`
}

export function buildAgentRunArgs(spec: AgentRunSpec): string[] {
  if (!spec.image || /[\s"'\\]/.test(spec.image)) throw new Error('invalid image')
  if (!CONTAINER_NAME.test(spec.containerName)) throw new Error('invalid container name')
  const args = [
    'run',
    '--rm',
    '-i',
    '--pull',
    'never',
    '--name',
    spec.containerName,
    '--label',
    'app=shopify-builder',
    '--label',
    'role=agent',
    '--user',
    '10001:10001',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '512',
    '--memory',
    '2g',
    '--cpus',
    '2',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--log-driver',
    'none',
    '--network',
    AGENT_NETWORK_NAME,
    '--mount',
    mount(spec.workspaceHostPath, AGENT_WORKSPACE_TARGET),
    '--mount',
    mount(spec.agentStateHostPath, AGENT_STATE_TARGET),
    spec.image,
  ]
  return args
}

export function buildAgentKillArgs(containerName: string): string[] {
  if (!CONTAINER_NAME.test(containerName)) throw new Error('invalid container name')
  return ['kill', containerName]
}

export function buildAgentNetworkCreateArgs(name = AGENT_NETWORK_NAME): string[] {
  if (name !== AGENT_NETWORK_NAME || !NETWORK_NAME.test(name)) throw new Error('invalid network name')
  return ['network', 'create', '--internal', '--label', 'app=shopify-builder', name]
}

export function buildAgentNetworkInspectArgs(name = AGENT_NETWORK_NAME): string[] {
  if (name !== AGENT_NETWORK_NAME) throw new Error('invalid network name')
  return ['network', 'inspect', '--format', '{{.Internal}}', name]
}

/** `docker network inspect` wrote `true` only when the network exists and has no route out. */
export function interpretAgentNetwork(exitCode: number, stdout: string): 'ready' | 'missing' | 'not-internal' {
  if (exitCode !== 0) return 'missing'
  if (stdout.trim() === 'true') return 'ready'
  return 'not-internal'
}

function mount(source: string, target: string): string {
  if (!path.isAbsolute(source) || /[,"=\n\r]/.test(source)) throw new Error('invalid mount path')
  return `type=bind,source=${source},target=${target}`
}
