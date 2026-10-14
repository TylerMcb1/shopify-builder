import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const mode = process.argv[2] === 'approval' ? 'approval' : '1'
const child = spawn(electron, ['.'], {
  env: { ...process.env, SHOPIFY_BUILDER_SMOKE: mode },
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 1))
