// Starts the Shopify container for Theme Check and for pushes (README 11).
import { randomBytes } from 'node:crypto'
import { runContainer, runWithSecretHandoff } from '../docker/adapter.ts'
import { buildShopifyRunArgs } from '../docker/run-args.ts'
import { HostError } from '../errors.ts'
import { redact } from '../redact.ts'
import { parseThemeCheckOutput, THEME_CHECK_ARGS, type Offense } from '../validation/theme-check.ts'

export function createShopifyRunner(config: {
  image?: string
  getThemeToken: () => Promise<string>
  network?: string
  dockerCommand?: string
  dockerEnv?: NodeJS.ProcessEnv
}) {
  const image = config.image ?? 'shopify-builder/shopify:local'
  const network = config.network ?? 'bridge'

  return {
    async themeCheck(themeDir: string): Promise<Offense[]> {
      const containerName = `sb-shopify-${randomBytes(6).toString('hex')}`
      const args = buildShopifyRunArgs({
        image,
        network: 'none',
        containerName,
        themeHostPath: themeDir,
        handoff: 'none',
        cliArgs: THEME_CHECK_ARGS,
      })
      const result = await runContainer({
        args,
        containerName,
        timeoutMs: 3 * 60_000,
        dockerCommand: config.dockerCommand,
        dockerEnv: config.dockerEnv,
      })
      if (result.exitCode !== 0) {
        throw new HostError('cli-failed', "Couldn't check this theme. Nothing was saved.", result.stderr.slice(-2000))
      }
      try {
        return parseThemeCheckOutput(result.stdout)
      } catch (err) {
        throw new HostError('invalid-output', "Couldn't read the theme check result.", (err as Error).message)
      }
    },
    async push(cliArgs: readonly string[], themeDir: string): Promise<string> {
      const containerName = `sb-shopify-${randomBytes(6).toString('hex')}`
      const args = buildShopifyRunArgs({
        image,
        network,
        containerName,
        themeHostPath: themeDir,
        cliArgs,
      })
      let token = ''
      const result = await runWithSecretHandoff({
        args,
        containerName,
        timeoutMs: 10 * 60_000,
        dockerCommand: config.dockerCommand,
        dockerEnv: config.dockerEnv,
        getSecret: async () => (token = await config.getThemeToken()),
      })
      const stderr = redact(result.stderr, [token])
      token = ''
      if (result.exitCode !== 0) {
        throw new HostError('cli-failed', "Couldn't update the theme on Shopify. Please try again.", stderr.slice(-2000))
      }
      return result.stdout
    },
  }
}
