// Shopify read service (README 11): the only host code, besides the write gateway, that starts a
// Shopify container. Reads only: list themes, pull a theme by immutable ID into a fresh inbox/,
// run file intake, record a `sync` commit, and publish the accepted files to canonical/.
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { runWithSecretHandoff, parseEntrypointRefusal, type DockerRunResult } from '../docker/adapter.ts'
import { buildShopifyRunArgs, INBOX_MOUNT_TARGET } from '../docker/run-args.ts'
import { HostError } from '../errors.ts'
import { createGit } from '../git/git.ts'
import { createHistoryService, type HistoryService, type SyncResult } from '../git/history.ts'
import { intakeDirectory, IntakeLimitError, type IntakeLimits, type RejectedFile } from '../intake/intake.ts'
import { loadPathPolicy, type PathPolicy } from '../intake/policy.ts'
import { redact } from '../redact.ts'
import { assertThemeId, themePaths } from '../store/layout.ts'
import { parseThemeList, STORE_DOMAIN, type Theme } from './schemas.ts'

export interface ShopifyReadServiceConfig {
  userDataDir: string
  storeId: string
  /** Non-secret store setting, e.g. "example.myshopify.com" (README 11). */
  storeDomain: string
  /** Decrypts the Theme Access password from safeStorage; called once per container, at handoff time. */
  getThemeToken: () => Promise<string>
  /** Image reference; releases use an immutable digest (README 4). */
  image?: string
  /** Docker network with normal outbound access. */
  network?: string
  dockerCommand?: string
  dockerEnv?: NodeJS.ProcessEnv
  listTimeoutMs?: number
  pullTimeoutMs?: number
  policy?: PathPolicy
  intakeLimits?: IntakeLimits
}

export interface PullResult {
  theme: Theme
  /** The `sync` commit on the theme's `shopify` branch (or the unchanged tip if nothing differed). */
  sync: SyncResult
  canonicalPath: string
  /** Accepted file paths, sorted. */
  files: string[]
  sensitiveFiles: string[]
  rejected: RejectedFile[]
}

export interface ShopifyReadService {
  listThemes(): Promise<Theme[]>
  pullTheme(themeId: number): Promise<PullResult>
  /** Pull, intake, and record a sync commit without replacing canonical/ (README 13). */
  syncTheme(themeId: number): Promise<{ theme: Theme; sync: SyncResult }>
}

export function createShopifyReadService(config: ShopifyReadServiceConfig): ShopifyReadService {
  if (!STORE_DOMAIN.test(config.storeDomain)) throw new Error('invalid store domain')
  themePaths(config.userDataDir, config.storeId, 1) // validates userDataDir and storeId up front

  const image = config.image ?? 'shopify-builder/shopify:local'
  const network = config.network ?? 'bridge'
  const policy = config.policy ?? loadPathPolicy()
  const inFlight = new Set<number>()
  let history: Promise<HistoryService> | undefined

  const run = async (cliArgs: string[], timeoutMs: number, inboxHostPath?: string): Promise<DockerRunResult> => {
    const containerName = `sb-shopify-${randomBytes(6).toString('hex')}`
    const args = buildShopifyRunArgs({ image, network, containerName, inboxHostPath, cliArgs })
    let token = ''
    const result = await runWithSecretHandoff({
      args,
      containerName,
      timeoutMs,
      dockerCommand: config.dockerCommand,
      dockerEnv: config.dockerEnv,
      getSecret: async () => (token = await config.getThemeToken()),
    })
    const stderr = redact(result.stderr, [token])
    token = ''
    if (result.exitCode !== 0) {
      const refusal = parseEntrypointRefusal(stderr)
      if (refusal) throw new HostError('container-refused', 'The Shopify tool refused this request.', refusal)
      throw new HostError('cli-failed', "Couldn't reach your store. Please check your internet connection and Shopify connection, then try again.", stderr.slice(-2000))
    }
    return { ...result, stderr }
  }

  const listThemes = async (): Promise<Theme[]> => {
    const { stdout } = await run(['theme', 'list', '--json', '--no-color', '--store', config.storeDomain], config.listTimeoutMs ?? 60_000)
    try {
      return parseThemeList(stdout)
    } catch (err) {
      throw new HostError('invalid-output', 'Shopify sent back a theme list the app could not read.', (err as Error).message)
    }
  }

  const pullTheme = async (themeId: number): Promise<PullResult> => {
    const pulled = await ingest(themeId, true)
    return {
      theme: pulled.theme,
      sync: pulled.sync,
      canonicalPath: themePaths(config.userDataDir, config.storeId, themeId).canonical,
      files: pulled.files,
      sensitiveFiles: pulled.sensitiveFiles,
      rejected: pulled.rejected,
    }
  }

  const syncTheme = async (themeId: number) => {
    const pulled = await ingest(themeId, false)
    return { theme: pulled.theme, sync: pulled.sync }
  }

  const ingest = async (themeId: number, replaceCanonical: boolean) => {
    try {
      assertThemeId(themeId)
    } catch {
      throw new HostError('invalid-input', 'That theme could not be found.')
    }
    if (inFlight.has(themeId)) throw new HostError('busy', 'This theme is already being downloaded.')
    inFlight.add(themeId)
    const paths = themePaths(config.userDataDir, config.storeId, themeId)
    try {
      const matches = (await listThemes()).filter((t) => t.id === themeId)
      if (matches.length !== 1) throw new HostError('theme-not-found', 'That theme could not be found in your store. It may have been deleted.')
      const theme = matches[0]!

      await fs.rm(paths.inbox, { recursive: true, force: true })
      await fs.mkdir(paths.inbox, { recursive: true })

      await run(
        ['theme', 'pull', '--theme', String(themeId), '--path', INBOX_MOUNT_TARGET, '--store', config.storeDomain, '--no-color'],
        config.pullTimeoutMs ?? 10 * 60_000,
        paths.inbox,
      )

      let intake
      try {
        intake = await intakeDirectory(paths.inbox, policy, config.intakeLimits)
      } catch (err) {
        if (err instanceof IntakeLimitError) throw new HostError('invalid-output', 'This theme is larger than the app supports.', err.message)
        throw err
      }
      if (intake.accepted.length === 0) throw new HostError('empty-pull', 'Shopify returned no usable theme files.')

      const files = intake.accepted.map((f) => f.path)
      const staging = await stageFiles(paths.themeDir, intake.accepted)
      let sync: SyncResult
      try {
        history ??= createGit(config.userDataDir).then(createHistoryService)
        sync = await (await history).recordSync({ gitDir: paths.historyGit, treeDir: staging, files, source: theme })
      } catch (err) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
        throw new HostError('history-failed', "Couldn't save this theme's history. Your files haven't changed.", (err as Error).message)
      }
      if (replaceCanonical) await swapIntoCanonical(paths.themeDir, staging, paths.canonical)
      else await fs.rm(staging, { recursive: true, force: true })

      return {
        theme,
        sync,
        files: intake.accepted.map((f) => f.path).sort(),
        sensitiveFiles: intake.accepted.filter((f) => f.sensitive).map((f) => f.path).sort(),
        rejected: intake.rejected,
      }
    } finally {
      await fs.rm(paths.inbox, { recursive: true, force: true }).catch(() => {})
      inFlight.delete(themeId)
    }
  }

  return { listThemes, pullTheme, syncTheme }
}

/** Writes accepted files to a host-only staging tree; it becomes canonical/ only after the sync commit. */
async function stageFiles(themeDir: string, files: { path: string; data: Buffer }[]): Promise<string> {
  const staging = path.join(themeDir, `.canonical-staging-${randomBytes(6).toString('hex')}`)
  await fs.mkdir(staging, { recursive: true })
  try {
    for (const file of files) {
      const dest = path.join(staging, ...file.path.split('/'))
      if (!dest.startsWith(staging + path.sep)) throw new Error('path escapes staging')
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, file.data, { flag: 'wx' })
    }
    return staging
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/** Swaps the staging tree in for canonical/ so readers never see a partial theme. */
async function swapIntoCanonical(themeDir: string, staging: string, canonical: string): Promise<void> {
  const old = path.join(themeDir, `.canonical-old-${randomBytes(6).toString('hex')}`)
  const hadCanonical = await fs.stat(canonical).then(() => true, () => false)
  if (hadCanonical) await fs.rename(canonical, old)
  await fs.rename(staging, canonical)
  if (hadCanonical) await fs.rm(old, { recursive: true, force: true })
}
