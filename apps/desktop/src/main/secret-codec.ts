// Electron safeStorage, used only in the main process (README 7).
import { safeStorage } from 'electron'
import type { SecretCodec } from '../../../../packages/host/src/credentials/secrets.ts'

export function electronSecretCodec(): SecretCodec {
  return {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
  }
}
