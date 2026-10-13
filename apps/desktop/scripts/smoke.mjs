import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const child = spawn(electron, ['.'], {
  env: { ...process.env, SHOPIFY_BUILDER_SMOKE: '1' },
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 1))
