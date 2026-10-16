// Ciphertext at rest (README 6.5, 7). The codec is safeStorage in the app and a fake in tests.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface SecretCodec {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(ciphertext: Buffer): string
}

type FileShape = { anthropic?: string; shopify?: string }

export function openSecretStore(userDataDir: string, codec: SecretCodec) {
  if (!path.isAbsolute(userDataDir)) throw new Error('userDataDir must be absolute')
  const file = path.join(userDataDir, 'secrets.json')

  const read = (): FileShape => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const record = parsed as FileShape
      return {
        anthropic: typeof record.anthropic === 'string' ? record.anthropic : undefined,
        shopify: typeof record.shopify === 'string' ? record.shopify : undefined,
      }
    } catch {
      return {}
    }
  }

  const write = (next: FileShape) => {
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(file, JSON.stringify(next))
  }

  const load = (slot: keyof FileShape): string | null => {
    const encoded = read()[slot]
    if (!encoded) return null
    try {
      return codec.decrypt(Buffer.from(encoded, 'base64'))
    } catch {
      return null
    }
  }

  return {
    available: () => codec.available(),
    has(slot: keyof FileShape): boolean {
      return Boolean(read()[slot])
    },
    save(slot: keyof FileShape, plain: string) {
      if (!codec.available()) throw new Error('encryption unavailable')
      const next = read()
      next[slot] = codec.encrypt(plain).toString('base64')
      write(next)
    },
    load,
    /** True when ciphertext is present but can no longer be opened. */
    locked(slot: keyof FileShape): boolean {
      return Boolean(read()[slot]) && load(slot) === null
    },
    remove(slot: keyof FileShape) {
      const next = read()
      delete next[slot]
      write(next)
    },
  }
}
