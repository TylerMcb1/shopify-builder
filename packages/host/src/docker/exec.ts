// Argument-array Docker CLI calls. Never a shell, never a secret in argv (README 11, 6.6).
import { spawn } from 'node:child_process'

export interface DockerExecResult {
  exitCode: number
  stdout: string
  stderr: string
  /** Set when the docker binary could not be started (for example, it is not installed). */
  spawnError: string | null
}

export function dockerExec(
  dockerCommand: string,
  args: readonly string[],
  opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<DockerExecResult> {
  const timeoutMs = opts?.timeoutMs ?? 8_000
  return new Promise((resolve) => {
    const child = spawn(dockerCommand, args, {
      shell: false,
      windowsHide: true,
      env: opts?.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false
    const finish = (result: DockerExecResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ exitCode: 1, stdout: '', stderr: 'timed out', spawnError: null })
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ exitCode: 1, stdout: '', stderr: '', spawnError: error.code ?? 'error' })
    })
    child.on('close', (code) => {
      finish({
        exitCode: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        spawnError: null,
      })
    })
  })
}
