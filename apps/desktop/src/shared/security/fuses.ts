// Fuses applied to a packaged Electron binary (README 20). Not flipped on the dev binary.
import { FuseV1Options } from '@electron/fuses'

export const fuseOptions = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
} as const
