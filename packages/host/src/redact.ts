// Patterns that look like credentials (README 7.3, 14.1). Used both to redact logs and to reject file content.
export const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /shp(?:at|ca|pa|ss|tka)_[A-Za-z0-9]{16,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
]

export function containsCredential(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((re) => {
    re.lastIndex = 0
    return re.test(text)
  })
}

export function redact(text: string, extraSecrets: readonly string[] = []): string {
  let out = text
  for (const secret of extraSecrets) if (secret) out = out.split(secret).join('[REDACTED]')
  for (const re of CREDENTIAL_PATTERNS) out = out.replace(re, '[REDACTED]')
  return out
}
