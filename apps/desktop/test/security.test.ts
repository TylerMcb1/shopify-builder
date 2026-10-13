import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FuseV1Options } from '@electron/fuses'
import { STORE_DOMAIN as HOST_STORE_DOMAIN } from '../../../packages/host/src/shopify/schemas.ts'
import { ipcChannelNames, ipcChannels } from '../src/shared/contracts/channels.ts'
import {
  contentSecurityPolicy,
  createWindowSecurityOptions,
  isTrustedRendererUrl,
  shouldBlockNavigation,
} from '../src/shared/security/baseline.ts'
import { fuseOptions } from '../src/shared/security/fuses.ts'
import { EXTERNAL_LINKS, STORE_DOMAIN, classifyExternalUrl } from '../src/shared/security/links.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the renderer window cannot use Node and stays sandboxed', () => {
  const options = createWindowSecurityOptions('/app/preload.js')
  assert.equal(options.webPreferences.contextIsolation, true)
  assert.equal(options.webPreferences.sandbox, true)
  assert.equal(options.webPreferences.nodeIntegration, false)
  assert.equal(options.webPreferences.nodeIntegrationInWorker, false)
  assert.equal(options.webPreferences.nodeIntegrationInSubFrames, false)
  assert.equal(options.webPreferences.webSecurity, true)
  assert.equal(options.webPreferences.webviewTag, false)
  assert.equal(options.webPreferences.allowRunningInsecureContent, false)
  assert.equal(options.webPreferences.preload, '/app/preload.js')
})

test('production CSP is strict and development allows only the dev server', () => {
  const prod = contentSecurityPolicy('production')
  const scriptOf = (policy: string) => policy.split('; ').find((part) => part.startsWith('script-src ')) ?? ''
  assert.match(prod, /default-src 'self'/)
  assert.match(prod, /object-src 'none'/)
  assert.match(prod, /frame-ancestors 'none'/)
  assert.equal(scriptOf(prod).includes('unsafe-eval'), false)
  assert.equal(scriptOf(prod).includes('unsafe-inline'), false)
  assert.equal(prod.includes('http:'), false)
  const dev = contentSecurityPolicy('development', 'http://localhost:5173/')
  assert.match(scriptOf(dev), /unsafe-inline/)
  assert.match(scriptOf(dev), /unsafe-eval/)
  assert.match(dev, /http:\/\/localhost:5173/)
  assert.match(dev, /ws:\/\/localhost:5173/)
})

test('navigation and IPC are limited to the loaded page', () => {
  const appUrl = 'http://localhost:5173/'
  assert.equal(shouldBlockNavigation('http://localhost:5173/', appUrl), false)
  assert.equal(shouldBlockNavigation('http://localhost:5173/?x=1#y', appUrl), false)
  assert.equal(shouldBlockNavigation('http://localhost:5173/other', appUrl), true)
  assert.equal(shouldBlockNavigation('https://evil.example/', appUrl), true)
  assert.equal(shouldBlockNavigation('file:///etc/passwd', appUrl), true)
  assert.equal(isTrustedRendererUrl('not a url', appUrl), false)

  const fileUrl = 'file:///app/out/renderer/index.html'
  assert.equal(shouldBlockNavigation(fileUrl, fileUrl), false)
  assert.equal(shouldBlockNavigation('file:///app/out/renderer/other.html', fileUrl), true)
})

test('external links allow only the documented hosts and the connected store', () => {
  assert.equal(classifyExternalUrl(EXTERNAL_LINKS.anthropicConsole, null).ok, true)
  assert.equal(classifyExternalUrl(EXTERNAL_LINKS.themeAccessHelp, null).ok, true)
  assert.equal(classifyExternalUrl(EXTERNAL_LINKS.shopifyAdmin, null).ok, true)
  assert.equal(classifyExternalUrl('https://example.myshopify.com/admin/themes', null).ok, false)
  assert.equal(classifyExternalUrl('https://example.myshopify.com/admin/themes', 'example.myshopify.com').ok, true)
  assert.equal(classifyExternalUrl('https://other.myshopify.com/', 'example.myshopify.com').ok, false)
  for (const bad of [
    'http://console.anthropic.com/',
    'https://user:pass@console.anthropic.com/',
    'https://console.anthropic.com.evil.com/',
    'https://evil.com/?next=https://admin.shopify.com/',
    'file:///tmp/x',
    'javascript:alert(1)',
    'not a url',
  ]) {
    assert.equal(classifyExternalUrl(bad, 'example.myshopify.com').ok, false, bad)
  }
  assert.equal(STORE_DOMAIN.source, HOST_STORE_DOMAIN.source)
})

test('packaged fuses disable Node and turn integrity checks on', () => {
  assert.equal(fuseOptions[FuseV1Options.RunAsNode], false)
  assert.equal(fuseOptions[FuseV1Options.EnableNodeOptionsEnvironmentVariable], false)
  assert.equal(fuseOptions[FuseV1Options.EnableNodeCliInspectArguments], false)
  assert.equal(fuseOptions[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true)
  assert.equal(fuseOptions[FuseV1Options.OnlyLoadAppFromAsar], true)
  assert.equal(Object.keys(fuseOptions).length, 5)
})

test('preload exposes only the phase 1 channels and no shell', () => {
  const preload = readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8')
  assert.match(preload, /exposeInMainWorld\('shopifyBuilder'/)
  for (const name of Object.keys(ipcChannels) as (keyof typeof ipcChannels)[]) {
    assert.match(preload, new RegExp(`ipcChannels\\.${name}`))
  }
  assert.equal(preload.includes('ipcRenderer.invoke('), true)
  assert.equal(/invoke\(\s*['"`]/.test(preload), false)
  assert.equal(preload.includes('shell.'), false)
  assert.equal(preload.includes('child_process'), false)
  assert.equal(preload.includes("from 'fs'"), false)
  assert.equal(preload.includes('nodeIntegration'), false)
  assert.deepEqual(ipcChannelNames, ['setup:getStatus', 'setup:retryDocker', 'links:open'])
})

test('main keeps the security baseline and a single-instance lock', () => {
  const main = readSources(path.join(root, 'src/main'))
  assert.match(main, /requestSingleInstanceLock/)
  assert.equal(main.includes('nodeIntegration: true'), false)
  assert.equal(main.includes('sandbox: false'), false)
  assert.equal(main.includes('webviewTag: true'), false)
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  assert.match(main, /setPermissionRequestHandler/)
})

function readSources(dir: string): string {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(path.join(dir, name), 'utf8'))
    .join('\n')
}
