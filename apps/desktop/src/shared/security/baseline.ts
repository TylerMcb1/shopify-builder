// Electron window and navigation policy (README 20). Pure data so tests do not start Electron.

export function createWindowSecurityOptions(preloadPath: string) {
  return {
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
    },
  } as const
}

export function contentSecurityPolicy(mode: 'development' | 'production', devServerUrl?: string): string {
  const script = ["'self'"]
  const connect = ["'self'"]
  if (mode === 'development' && devServerUrl) {
    const dev = new URL(devServerUrl)
    // Vite's React plugin injects an inline module preamble. Production builds do not.
    script.push("'unsafe-inline'", "'unsafe-eval'")
    connect.push(dev.origin, `ws://${dev.host}`)
  }
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** In-app navigation is allowed only to the exact page the main process loaded. */
export function shouldBlockNavigation(targetUrl: string, appUrl: string): boolean {
  return canonicalAppUrl(targetUrl) !== canonicalAppUrl(appUrl)
}

export function isTrustedRendererUrl(frameUrl: string, appUrl: string): boolean {
  return !shouldBlockNavigation(frameUrl, appUrl)
}

function canonicalAppUrl(value: string): string | null {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    if (url.protocol === 'file:') return `file://${url.pathname}`
    const path = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
    return `${url.origin}${path}`
  } catch {
    return null
  }
}
