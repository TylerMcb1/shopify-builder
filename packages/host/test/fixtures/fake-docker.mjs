#!/usr/bin/env node
// Stand-in for the Docker CLI. Checks the hardened run arguments, then runs the REAL Shopify
// container entrypoint (containers/shopify/src/entrypoint.mjs) with a fake `shopify` binary on PATH,
// so the sealed-box handoff and container policy are exercised exactly as in the image.
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entrypoint = path.resolve(here, '../../../../containers/shopify/src/entrypoint.mjs')
const args = process.argv.slice(2)

if (process.env.FAKE_DOCKER_LOG) appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\n')
if (args[0] === 'rm') process.exit(0)
if (args[0] !== 'run') process.exit(125)

const die = (msg) => {
  process.stderr.write(`fake-docker: ${msg}\n`)
  process.exit(125)
}
for (const flag of ['--rm', '-i', '--read-only', '--cap-drop', '--security-opt', '--user', '--pull', '--log-driver', '--network', '--name']) {
  if (!args.includes(flag)) die(`missing ${flag}`)
}
if (args.some((a) => /shptka_|sk-ant-|SHOPIFY_CLI_THEME_TOKEN/.test(a))) die('secret on the command line')
if (args.includes('-e') || args.includes('--env')) die('environment passed to container')

const image = process.env.FAKE_DOCKER_IMAGE ?? 'shopify-builder/shopify:test'
const imageIdx = args.indexOf(image)
if (imageIdx === -1) die('image not found in args')
const mountIdx = args.indexOf('--mount')
const inbox = mountIdx === -1 ? '' : (/source=([^,]+)/.exec(args[mountIdx + 1])?.[1] ?? '')

const child = spawn(process.execPath, [entrypoint, ...args.slice(imageIdx + 1)], {
  stdio: 'inherit',
  env: { ...process.env, PATH: `${path.join(here, 'bin')}${path.delimiter}${process.env.PATH}`, FAKE_INBOX: inbox },
})
child.on('exit', (code) => process.exit(code ?? 1))
