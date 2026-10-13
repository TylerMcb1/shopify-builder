// Runs one `docker run` with the encrypted secret handoff on stdin (README 6.5).
// Docker is always invoked with an argument array, never through a shell (README 11).
import { spawn } from 'node:child_process'
import { isHandoffPublicKey, sealSecret } from '../credentials/seal.ts'
import { HostError } from '../errors.ts'
import { redact } from '../redact.ts'

export interface DockerRunOptions {
  args: readonly string[]
  /** Name passed to `docker run --name`, used to force-remove the container on timeout. */
  containerName: string
  /** Returns the plaintext secret only at the moment of the handoff. */
  getSecret: () => Promise<string>
  timeoutMs: number
  dockerCommand?: string
  /** Environment of the Docker client process (e.g. DOCKER_HOST). Never contains a secret. */
  dockerEnv?: NodeJS.ProcessEnv
  maxOutputBytes?: number
}

export interface DockerRunResult {
  exitCode: number
  /** Container stdout after the handoff public-key line. */
  stdout: string
  stderr: string
}

const DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024
const MAX_HANDOFF_LINE = 256

export function runWithSecretHandoff(opts: DockerRunOptions): Promise<DockerRunResult> {
  const docker = opts.dockerCommand ?? 'docker'
  const maxOutput = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT

  return new Promise((resolve, reject) => {
    const child = spawn(docker, opts.args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.dockerEnv ?? process.env,
      windowsHide: true,
    })

    let settled = false
    let handoffStarted = false
    let pending = ''
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outBytes = 0
    let errBytes = 0

    const finish = (err: HostError | null, result?: DockerRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) {
        child.kill('SIGKILL')
        reject(err)
      } else resolve(result!)
    }

    const forceRemove = () => {
      spawn(docker, ['rm', '-f', opts.containerName], {
        shell: false,
        stdio: 'ignore',
        env: opts.dockerEnv ?? process.env,
      }).on('error', () => {})
    }

    const timer = setTimeout(() => {
      forceRemove()
      finish(new HostError('timeout', 'Shopify took too long to respond. Please try again.'))
    }, opts.timeoutMs)

    const handoff = async (publicKey: string) => {
      let secret = ''
      try {
        secret = await opts.getSecret()
        const sealed = await sealSecret(publicKey, secret)
        child.stdin.end(sealed + '\n')
      } catch {
        finish(
          new HostError(
            'handoff-failed',
            "Couldn't pass your Shopify connection to the Shopify tool. Please try again.",
          ),
        )
      } finally {
        secret = ''
      }
    }

    child.stdin.on('error', () => {}) // container may exit before reading; reported through exit code
    child.stdout.on('data', (chunk: Buffer) => {
      if (!handoffStarted) {
        pending += chunk.toString('utf8')
        const nl = pending.indexOf('\n')
        if (nl === -1) {
          if (pending.length > MAX_HANDOFF_LINE)
            finish(new HostError('handoff-failed', "The Shopify tool didn't start correctly.", 'handoff line too long'))
          return
        }
        handoffStarted = true
        const line = pending.slice(0, nl).trim()
        const rest = pending.slice(nl + 1)
        pending = ''
        if (!isHandoffPublicKey(line)) {
          finish(
            new HostError(
              'handoff-failed',
              "The Shopify tool didn't start correctly.",
              'unexpected first line from container',
            ),
          )
          return
        }
        if (rest) stdout.push(Buffer.from(rest, 'utf8'))
        void handoff(line)
        return
      }
      outBytes += chunk.length
      if (outBytes > maxOutput)
        return finish(new HostError('invalid-output', 'Shopify sent back more data than expected.'))
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errBytes += chunk.length
      if (errBytes <= maxOutput) stderr.push(chunk)
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(new HostError('docker-unavailable', 'Please open Docker Desktop, then click Retry.', err.code))
    })
    child.on('close', (code, signal) => {
      const err = redact(Buffer.concat(stderr).toString('utf8'))
      if (!handoffStarted) {
        // Exited before offering a public key: entrypoint refusal, missing image, or Docker failure.
        const refusal = parseEntrypointRefusal(err)
        if (refusal)
          return finish(new HostError('container-refused', 'The Shopify tool refused this request.', refusal))
        if (code === 125)
          return finish(
            new HostError(
              'docker-unavailable',
              "Couldn't start the Shopify tool. Please check Docker Desktop.",
              err.slice(0, 2000),
            ),
          )
        return finish(new HostError('handoff-failed', "The Shopify tool didn't start correctly.", err.slice(0, 2000)))
      }
      finish(null, {
        exitCode: code ?? (signal ? 1 : 0),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: err,
      })
    })
  })
}

export function parseEntrypointRefusal(stderr: string): string | null {
  for (const line of stderr.split('\n')) {
    try {
      const msg = JSON.parse(line)
      if (msg?.source === 'shopify-entrypoint' && typeof msg.error === 'string') return msg.error
    } catch {}
  }
  return null
}
