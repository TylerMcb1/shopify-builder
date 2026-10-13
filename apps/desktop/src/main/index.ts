import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkDockerDesktop } from '../../../../packages/host/src/docker/status.ts'
import { checkToolImages, readToolManifest, type ToolManifest } from '../../../../packages/host/src/docker/images.ts'
import { LINK_DENIED, type OpenExternalResult } from '../shared/contracts/setup.ts'
import { palette } from '../shared/design/tokens.ts'
import { contentSecurityPolicy, createWindowSecurityOptions } from '../shared/security/baseline.ts'
import { classifyExternalUrl } from '../shared/security/links.ts'
import { collectSetupStatus } from './foundation.ts'
import { hardenWebContents, registerIpc } from './ipc.ts'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    const appUrl = rendererUrl()
    installSessionPolicy(appUrl)
    registerIpc(ipcMain, {
      getAppUrl: () => appUrl,
      getSetupStatus: () => loadStatus(),
      openExternal: openAllowedLink,
    })
    const win = createWindow(appUrl)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(appUrl)
    })
    if (process.env['SHOPIFY_BUILDER_SMOKE'] === '1') watchSmoke(win)
  })

  app.on('window-all-closed', () => app.quit())
}

function rendererUrl(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return devUrl
  return pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
}

function installSessionPolicy(appUrl: string): void {
  const mode = process.env['ELECTRON_RENDERER_URL'] ? 'development' : 'production'
  const policy = contentSecurityPolicy(mode, process.env['ELECTRON_RENDERER_URL'])
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, appUrl))
}

function createWindow(appUrl: string): BrowserWindow {
  const preload = path.join(__dirname, '../preload/index.cjs')
  const win = new BrowserWindow({
    width: 960,
    height: 800,
    minWidth: 720,
    minHeight: 640,
    show: false,
    title: 'Shopify Builder',
    backgroundColor: palette.background,
    webPreferences: createWindowSecurityOptions(preload).webPreferences,
  })
  hardenWebContents(win.webContents, appUrl)
  if (process.env['SHOPIFY_BUILDER_SMOKE'] !== '1') {
    win.once('ready-to-show', () => win.show())
  }
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

async function loadStatus() {
  const manifestPath = path.join(__dirname, '../../resources/tool-manifest.json')
  let manifest: ToolManifest | null = null
  try {
    manifest = await readToolManifest(manifestPath)
  } catch {
    manifest = null
  }
  return collectSetupStatus({
    manifestOk: manifest !== null,
    checkDocker: () => checkDockerDesktop({ minimumVersion: manifest?.minimumDockerVersion ?? '24.0.0' }),
    checkImages: async () => {
      if (!manifest) throw new Error('missing manifest')
      return checkToolImages({ manifest })
    },
  })
}

async function openAllowedLink(raw: string): Promise<OpenExternalResult> {
  const classified = classifyExternalUrl(raw, null)
  if (!classified.ok) return { ok: false, message: LINK_DENIED }
  try {
    await shell.openExternal(classified.url)
  } catch {
    return { ok: false, message: LINK_DENIED }
  }
  return { ok: true, message: '' }
}

function watchSmoke(win: BrowserWindow): void {
  const fail = (text: string) => {
    process.stdout.write(`SMOKE_FAIL ${JSON.stringify(text)}\n`)
    app.exit(1)
  }
  win.webContents.on('console-message', (event) => {
    const message = typeof event === 'object' && event !== null && 'message' in event ? String(event.message) : ''
    if (message) process.stdout.write(`RENDERER ${message}\n`)
  })
  win.webContents.on('did-fail-load', (_event, code, description) => fail(`load ${code} ${description}`))
  void (async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const text = await win.webContents
        .executeJavaScript('document.body ? document.body.innerText : ""')
        .catch(() => '')
      if (!text.includes('Connect Claude')) continue
      const banned = /\bpublish\b|make live|replace live/i.test(text)
      const offline = text.includes('Open this screen in the Shopify Builder app')
      const docker =
        /Ready|Please open Docker Desktop|Please install Docker Desktop|Please update Docker Desktop|Windows containers|Checking Docker Desktop/.test(
          text,
        )
      if (!banned && !offline && docker && text.includes('Connect your store')) {
        process.stdout.write('SMOKE_OK\n')
        app.exit(0)
      }
      if (banned) fail(text)
    }
    fail(await win.webContents.executeJavaScript('document.body.innerText').catch(() => ''))
  })()
}
