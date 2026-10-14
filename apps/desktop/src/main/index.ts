import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkDockerDesktop } from '../../../../packages/host/src/docker/status.ts'
import { checkToolImages, readToolManifest, type ToolManifest } from '../../../../packages/host/src/docker/images.ts'
import { SessionEventSchema } from '../../../../packages/host/src/agent/protocol.ts'
import { LINK_DENIED, type OpenExternalResult } from '../shared/contracts/setup.ts'
import { sessionEventChannel } from '../shared/contracts/channels.ts'
import { palette } from '../shared/design/tokens.ts'
import { contentSecurityPolicy, createWindowSecurityOptions } from '../shared/security/baseline.ts'
import { classifyExternalUrl } from '../shared/security/links.ts'
import { collectSetupStatus } from './foundation.ts'
import { hardenWebContents, registerIpc } from './ipc.ts'
import { createSessionBridge } from './session-bridge.ts'
import { HostError } from '../../../../packages/host/src/errors.ts'
import { CHANGE_MESSAGES } from '../../../../packages/host/src/change/messages.ts'
import { openRecords } from '../../../../packages/host/src/records/store.ts'
import { createShopifyReadService } from '../../../../packages/host/src/shopify/read-service.ts'
import { capturePreview } from './preview-capture.ts'

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

  app.whenReady().then(async () => {
    const appUrl = rendererUrl()
    const manifest = await loadManifest()
    installSessionPolicy(appUrl)
    let themeToken = ''
    let connectedDomain: string | null = null
    const bridge = createSessionBridge({
      userDataDir: app.getPath('userData'),
      image: manifest?.images.agent.id ?? manifest?.images.agent.ref ?? 'shopify-builder/agent:local',
      send: (event) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send(sessionEventChannel, event)
      },
      shopify: {
        image: manifest?.images.shopify.id ?? manifest?.images.shopify.ref ?? 'shopify-builder/shopify:local',
        getThemeToken: async () => {
          if (!themeToken) throw new HostError('invalid-input', CHANGE_MESSAGES.connectStore)
          return themeToken
        },
        capture: (pages, dir, when) => capturePreview(pages, dir, when),
      },
    })
    registerIpc(ipcMain, {
      getAppUrl: () => appUrl,
      getSetupStatus: () => loadStatus(manifest),
      openExternal: (url) => openAllowedLink(url, bridge.storeDomain() ?? connectedDomain),
      startSession: (input) => bridge.start(input),
      sendMessage: (text) => bridge.sendMessage(text),
      decideApproval: (requestId, decision) => bridge.decideApproval(requestId, decision),
      answerQuestion: (requestId, text) => bridge.answerQuestion(requestId, text),
      cancelSession: () => bridge.cancel(),
      saveSession: () => bridge.save(),
      discardSession: () => bridge.discard(),
      undoStep: () => bridge.undoStep(),
      redoOnLatest: () => bridge.redoOnLatest(),
      readShot: (page, viewport, when) => bridge.readShot(page, viewport, when),
      connectStore: async (domain, password) => {
        themeToken = password
        connectedDomain = domain
        return { ok: true, message: 'Store connected for this run.' }
      },
      pullTheme: async (domain, themeId) => {
        try {
          if (!themeToken) return { ok: false, message: CHANGE_MESSAGES.connectStore }
          const storeId = domain.split('.')[0] ?? ''
          const read = createShopifyReadService({
            userDataDir: app.getPath('userData'),
            storeId,
            storeDomain: domain,
            image: manifest?.images.shopify.id ?? manifest?.images.shopify.ref ?? 'shopify-builder/shopify:local',
            getThemeToken: async () => themeToken,
          })
          const pulled = await read.pullTheme(themeId)
          if (pulled.theme.role === 'unpublished') {
            openRecords(app.getPath('userData')).saveOwnership({
              storeId,
              themeId,
              kind: 'working-copy',
              name: pulled.theme.name,
              originThemeId: null,
              retired: false,
            })
          }
          const note =
            pulled.theme.role === 'unpublished'
              ? `Pulled ${pulled.theme.name}.`
              : `Pulled ${pulled.theme.name}. This theme can't be saved to.`
          return { ok: true, message: note }
        } catch (err) {
          const message = err instanceof HostError ? err.userMessage : 'The theme could not be pulled.'
          return { ok: false, message }
        }
      },
    })
    const win = createWindow(appUrl)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(appUrl)
    })
    const smoke = process.env['SHOPIFY_BUILDER_SMOKE']
    if (smoke === '1') watchSmoke(win)
    if (smoke === 'approval') watchApprovalSmoke(win)
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
  if (process.env['SHOPIFY_BUILDER_SMOKE'] !== '1' && process.env['SHOPIFY_BUILDER_SMOKE'] !== 'approval') {
    win.once('ready-to-show', () => win.show())
  }
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

async function loadManifest(): Promise<ToolManifest | null> {
  try {
    return await readToolManifest(path.join(__dirname, '../../resources/tool-manifest.json'))
  } catch {
    return null
  }
}

async function loadStatus(manifest: ToolManifest | null) {
  return collectSetupStatus({
    manifestOk: manifest !== null,
    checkDocker: () => checkDockerDesktop({ minimumVersion: manifest?.minimumDockerVersion ?? '24.0.0' }),
    checkImages: async () => {
      if (!manifest) throw new Error('missing manifest')
      return checkToolImages({ manifest })
    },
  })
}

async function openAllowedLink(raw: string, storeDomain: string | null): Promise<OpenExternalResult> {
  const classified = classifyExternalUrl(raw, storeDomain)
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

function watchApprovalSmoke(win: BrowserWindow): void {
  const sample = SessionEventSchema.parse({
    sessionId: 'smoke-session',
    seq: 1,
    type: 'approval_request',
    requestId: '00000000-0000-4000-8000-000000000001',
    files: [
      {
        path: 'config/settings_data.json',
        description: 'Your theme editor settings, such as colors, fonts, and section content.',
      },
    ],
  })
  const fail = (text: string) => {
    process.stdout.write(`SMOKE_FAIL ${JSON.stringify(text)}\n`)
    app.exit(1)
  }
  win.webContents.on('console-message', (event) => {
    const message = typeof event === 'object' && event !== null && 'message' in event ? String(event.message) : ''
    if (message) process.stdout.write(`RENDERER ${message}\n`)
  })
  win.webContents.on('preload-error', (_event, _path, error) => {
    process.stdout.write(`PRELOAD ${error.message}\n`)
  })
  void (async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (win.webContents.isLoading()) continue
      win.webContents.send(sessionEventChannel, sample)
      const report = await win.webContents
        .executeJavaScript(
          `(() => {
            const dialog = document.querySelector('[role="dialog"]')
            const button = dialog ? dialog.querySelector('button') : null
            return {
              text: document.body ? document.body.innerText : '',
              firstButton: button ? button.textContent : '',
              focused: document.activeElement ? document.activeElement.textContent : '',
            }
          })()`,
        )
        .catch(() => null)
      if (!report || !report.text.includes('Approve changes to important theme files?')) continue
      if (report.firstButton !== 'Decline') fail(report.text)
      if (/publish|make live|replace live/i.test(report.text)) fail(report.text)
      await win.webContents.executeJavaScript(
        `document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      const after = await win.webContents.executeJavaScript('document.body.innerText')
      if (after.includes('Approve changes to important theme files?')) fail(after)
      if (report.focused !== 'Decline' && report.firstButton !== 'Decline') fail(report.text)
      process.stdout.write('SMOKE_OK\n')
      app.exit(0)
    }
    fail('approval dialog did not appear')
  })()
}
