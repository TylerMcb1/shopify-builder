// External links the main process may open (README 20). Same store-domain rule as the host.
export const STORE_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/

export const EXTERNAL_LINKS = {
  anthropicConsole: 'https://console.anthropic.com/',
  themeAccessHelp: 'https://help.shopify.com/en/manual/online-store/themes/managing-themes/theme-access',
  shopifyAdmin: 'https://admin.shopify.com/',
} as const

const FIXED_HOSTS = new Set(['console.anthropic.com', 'admin.shopify.com', 'help.shopify.com'])

export function classifyExternalUrl(
  raw: string,
  storeDomain: string | null,
): { ok: true; url: string } | { ok: false } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false }
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return { ok: false }
  const host = url.hostname
  if (FIXED_HOSTS.has(host)) return { ok: true, url: url.toString() }
  if (storeDomain !== null && host === storeDomain.toLowerCase() && STORE_DOMAIN.test(host)) {
    return { ok: true, url: url.toString() }
  }
  return { ok: false }
}
