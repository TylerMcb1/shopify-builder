// Docker Desktop status at startup (README 6.6, 21.3). The app does not install or configure Docker.
import { dockerExec, type DockerExecResult } from './exec.ts'

export type DockerState = 'ready' | 'not-running' | 'windows-containers' | 'too-old' | 'unavailable'

export interface DockerStatus {
  state: DockerState
  /** Plain language for the setup screen. */
  message: string
  version: string | null
  os: string | null
}

export const DOCKER_MESSAGES = {
  open: 'Please open Docker Desktop, then click Retry.',
  update: 'Please update Docker Desktop, then click Retry.',
  install: 'Please install Docker Desktop, then click Retry.',
  switchLinux: 'Docker Desktop is using Windows containers. Switch it to Linux containers, then click Retry.',
  ready: 'Ready',
} as const

export interface DockerVersionReport {
  exitCode: number
  stdout: string
  stderr: string
  spawnError?: string | null
}

/** Pure interpretation of `docker version --format {{json .}}`, so tests do not need a daemon. */
export function interpretDockerVersion(report: DockerVersionReport, minimumVersion: string): DockerStatus {
  if (report.spawnError === 'ENOENT') {
    return { state: 'unavailable', message: DOCKER_MESSAGES.install, version: null, os: null }
  }
  if (report.spawnError || report.stderr === 'timed out' || !report.stdout.trim()) {
    return { state: 'not-running', message: DOCKER_MESSAGES.open, version: null, os: null }
  }

  let parsed: { Server?: { Version?: unknown; Os?: unknown } | null }
  try {
    parsed = JSON.parse(report.stdout) as { Server?: { Version?: unknown; Os?: unknown } | null }
  } catch {
    return { state: 'unavailable', message: DOCKER_MESSAGES.open, version: null, os: null }
  }

  const server = parsed.Server
  if (!server || typeof server.Version !== 'string') {
    return { state: 'not-running', message: DOCKER_MESSAGES.open, version: null, os: null }
  }

  const version = numericVersion(server.Version)
  const os = typeof server.Os === 'string' ? server.Os : null
  if (!version || !/^\d+\.\d+\.\d+$/.test(minimumVersion)) {
    return { state: 'unavailable', message: DOCKER_MESSAGES.open, version, os }
  }
  if (os !== 'linux') return { state: 'windows-containers', message: DOCKER_MESSAGES.switchLinux, version, os }
  if (compareVersions(version, minimumVersion) < 0) {
    return { state: 'too-old', message: DOCKER_MESSAGES.update, version, os }
  }
  return { state: 'ready', message: DOCKER_MESSAGES.ready, version, os }
}

export async function checkDockerDesktop(opts?: {
  dockerCommand?: string
  minimumVersion?: string
  env?: NodeJS.ProcessEnv
  run?: (args: readonly string[]) => Promise<DockerExecResult>
}): Promise<DockerStatus> {
  const minimumVersion = opts?.minimumVersion ?? '24.0.0'
  const run = opts?.run ?? ((args) => dockerExec(opts?.dockerCommand ?? 'docker', args, { env: opts?.env }))
  const report = await run(['version', '--format', '{{json .}}'])
  return interpretDockerVersion(report, minimumVersion)
}

function numericVersion(raw: string): string | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim())
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number(part))
  const pb = b.split('.').map((part) => Number(part))
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}
