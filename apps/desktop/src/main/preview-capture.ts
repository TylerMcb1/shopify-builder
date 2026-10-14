// Hidden preview window (README 8.4). It does not use the app preload, so the store page
// cannot call into the main process.
import { BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function shotFileName(when: 'before' | 'after', viewport: 'desktop' | 'mobile', pageType: string): string {
  return `${when}-${viewport}-${pageType.replace(/[^a-z0-9_-]/gi, '')}.png`
}

export async function capturePreview(
  pages: { pageType: string; url: string }[],
  dir: string,
  when: 'before' | 'after',
): Promise<void> {
  await mkdir(dir, { recursive: true })
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: 'preview',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
    },
  })
  try {
    for (const page of pages) {
      await win.loadURL(page.url)
      win.setContentSize(1280, 800)
      const desktop = await win.webContents.capturePage()
      await writeFile(path.join(dir, shotFileName(when, 'desktop', page.pageType)), desktop.toPNG())
      win.setContentSize(390, 844)
      const mobile = await win.webContents.capturePage()
      await writeFile(path.join(dir, shotFileName(when, 'mobile', page.pageType)), mobile.toPNG())
    }
  } finally {
    win.destroy()
  }
}
