// Hardened runner for the bundled, pinned Git binary (Dugite), host only (README 4, 12.6).
// The environment is built from scratch, so inherited GIT_* variables, system and global config,
// hooks, attributes, fsmonitor and symlinks can never influence a Git call.
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveGitBinary, setupEnvironment } from 'dugite'

export const IDENTITY = { name: 'Shopify Builder', email: 'builder@shopify-builder.invalid' }

export interface Git {
  /** Runs `git <hardening> --git-dir=<gitDir> <args>`. */
  run(gitDir: string, args: readonly string[], opts?: GitRunOptions): Promise<GitResult>
  /** Runs `git init --bare` for a new repository (the only call without --git-dir). */
  initBare(gitDir: string, initialBranch: string): Promise<void>
}

export interface GitRunOptions {
  stdin?: string | Buffer
  /** Only GIT_INDEX_FILE is accepted; everything else is fixed by the runner. */
  indexFile?: string
  okExitCodes?: readonly number[]
}

export interface GitResult {
  exitCode: number
  stdout: Buffer
  stderr: string
}

export class GitCommandError extends Error {
  readonly exitCode: number
  readonly stderr: string
  constructor(args: readonly string[], exitCode: number, stderr: string) {
    super(`git ${args[0] ?? ''} failed with exit code ${exitCode}`)
    this.name = 'GitCommandError'
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

const MAX_OUTPUT = 64 * 1024 * 1024

/** Creates the app-owned support files (empty hooks dir, empty config and attributes) under userDataDir. */
export async function createGit(userDataDir: string): Promise<Git> {
  if (!path.isAbsolute(userDataDir)) throw new Error('userDataDir must be absolute')
  const support = path.join(userDataDir, 'git-support')
  const hooksDir = path.join(support, 'empty-hooks')
  const emptyConfig = path.join(support, 'empty.gitconfig')
  const emptyAttributes = path.join(support, 'empty.gitattributes')
  await fs.mkdir(hooksDir, { recursive: true })
  if ((await fs.readdir(hooksDir)).length > 0) throw new Error('git hooks directory is not empty')
  for (const file of [emptyConfig, emptyAttributes]) {
    await fs.writeFile(file, '')
  }

  const hardening = [
    '-c', `core.hooksPath=${hooksDir}`,
    '-c', `core.attributesFile=${emptyAttributes}`,
    '-c', 'core.symlinks=false',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    '-c', 'core.longpaths=true',
    '-c', 'core.autocrlf=false',
    '-c', 'core.safecrlf=false',
    '-c', 'core.logAllRefUpdates=true',
    '-c', 'commit.gpgSign=false',
    '-c', 'tag.gpgSign=false',
    '-c', 'gc.auto=0',
    '-c', 'maintenance.auto=false',
    '-c', 'protocol.allow=never',
  ]

  const baseEnv: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_AUTHOR_NAME: IDENTITY.name,
    GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
    HOME: support,
    XDG_CONFIG_HOME: support,
    LC_ALL: 'C',
  }
  for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR']) {
    const value = process.env[key]
    if (value !== undefined) baseEnv[key] = value
  }

  const exec = (args: readonly string[], opts: GitRunOptions = {}): Promise<GitResult> => {
    const extra: Record<string, string> = {}
    if (opts.indexFile) extra.GIT_INDEX_FILE = opts.indexFile
    const { env } = setupEnvironment(extra, baseEnv)
    return new Promise((resolve, reject) => {
      const child = spawn(resolveGitBinary(), args as string[], { env: env as NodeJS.ProcessEnv, shell: false, windowsHide: true, cwd: support })
      const out: Buffer[] = []
      const err: Buffer[] = []
      let size = 0
      child.stdout.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_OUTPUT) child.kill('SIGKILL')
        else out.push(c)
      })
      child.stderr.on('data', (c: Buffer) => err.push(c))
      child.stdin.on('error', () => {})
      child.on('error', reject)
      child.on('close', (code) => {
        const result = { exitCode: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }
        if (size > MAX_OUTPUT) return reject(new GitCommandError(args, -1, 'output too large'))
        if (![0, ...(opts.okExitCodes ?? [])].includes(result.exitCode)) return reject(new GitCommandError(args, result.exitCode, result.stderr))
        resolve(result)
      })
      child.stdin.end(opts.stdin ?? '')
    })
  }

  return {
    run: (gitDir, args, opts) => exec([...hardening, `--git-dir=${gitDir}`, ...args], opts),
    initBare: async (gitDir, initialBranch) => {
      await exec([...hardening, 'init', '--bare', '--quiet', '--template=', `--initial-branch=${initialBranch}`, gitDir])
    },
  }
}
