// Hidden preview window (README 8.4). It does not use the app preload, so the store page
// cannot call into the main process.
import { BrowserWindow, nativeImage } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MODEL_IMAGE_MAX_BASE64, type ModelImage } from '../../../../packages/host/src/agent/protocol.ts'

/** A saved shot as a JPEG small enough to send to the model (containers/agent/policy/CONTEXT.md). */
export function shotForModel(file: string): ModelImage | null {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return null
  // Shots are saved at the screen's pixel density; 1280 wide matches the CSS viewport.
  const sized = image.getSize().width > 1280 ? image.resize({ width: 1280, quality: 'good' }) : image
  for (const quality of [75, 50]) {
    const data = sized.toJPEG(quality).toString('base64')
    if (data.length <= MODEL_IMAGE_MAX_BASE64) return { mediaType: 'image/jpeg', data }
  }
  return null
}

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
