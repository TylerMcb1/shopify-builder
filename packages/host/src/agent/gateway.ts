// Starts the Anthropic gateway on demand and hands it the key (README 6.4, 6.5).
import { spawn, type ChildProcess } from 'node:child_process'
import { isHandoffPublicKey, sealSecret } from '../credentials/seal.ts'
import { dockerExec } from '../docker/exec.ts'
import { HostError } from '../errors.ts'
import { buildGatewayConnectArgs, buildGatewayRemoveArgs, buildGatewayRunArgs } from './run-args.ts'

export interface GatewayHandle {
  stop(): Promise<void>
}

export async function startGateway(opts: {
  image: string
  getSecret: () => Promise<string>
  dockerCommand?: string
  dockerEnv?: NodeJS.ProcessEnv
  readyTimeoutMs?: number
}): Promise<GatewayHandle> {
  const docker = opts.dockerCommand ?? 'docker'
  const env = opts.dockerEnv ?? process.env
  await dockerExec(docker, buildGatewayRemoveArgs(), { env })
  const child = spawn(docker, buildGatewayRunArgs(opts.image), {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const stop = async () => {
    child.kill('SIGKILL')
    await dockerExec(docker, buildGatewayRemoveArgs(), { env })
  }
  try {
    await handoff(child, opts.getSecret)
    const attached = await dockerExec(docker, buildGatewayConnectArgs(), { env, timeoutMs: 15_000 })
    if (attached.exitCode !== 0 && !/already exists/i.test(attached.stderr)) {
      throw new HostError('docker-unavailable', 'Please open Docker Desktop, then click Retry.', attached.stderr.slice(-500))
    }
    await waitUntilReady(child, () => stderr, opts.readyTimeoutMs ?? 20_000)
  } catch (err) {
    await stop()
    throw err
  }
  return { stop }
}

function handoff(child: ChildProcess, getSecret: () => Promise<string>): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending = ''
    let secret = ''
    const fail = (message: string) => reject(new HostError('handoff-failed', "Couldn't start the Claude connection. Please try again.", message))
    const timer = setTimeout(() => fail('handoff timed out'), 15_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8')
      const nl = pending.indexOf('\n')
      if (nl === -1) return
      const line = pending.slice(0, nl).trim()
      clearTimeout(timer)
      if (!isHandoffPublicKey(line)) return fail('unexpected gateway greeting')
      void (async () => {
        try {
          secret = await getSecret()
          const sealed = await sealSecret(line, secret)
          child.stdin?.end(sealed + '\n')
          resolve()
        } catch (err) {
          fail(err instanceof Error ? err.message : 'handoff failed')
        } finally {
          secret = ''
        }
      })()
    })
    child.on('error', () => fail('docker did not start'))
    child.on('exit', () => fail('gateway exited during handoff'))
  })
}

function waitUntilReady(child: ChildProcess, stderr: () => string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stderr().includes('"event":"ready"')) return resolve()
    const timer = setTimeout(() => reject(new HostError('timeout', 'The Claude connection took too long to start.')), timeoutMs)
    const onData = () => {
      if (!stderr().includes('"event":"ready"')) return
      clearTimeout(timer)
      child.stderr?.off('data', onData)
      resolve()
    }
    child.stderr?.on('data', onData)
    child.on('exit', () => {
      clearTimeout(timer)
      reject(new HostError('cli-failed', "Couldn't start the Claude connection. Please try again.", stderr().slice(-500)))
    })
  })
}
