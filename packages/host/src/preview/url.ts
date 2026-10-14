// Preview URLs are built by the host from the store domain and theme id (README 8.4, 11).
// Page types that need a product, page, or article handle are ignored.
import { KNOWN_PAGE_TYPES } from '../agent/protocol.ts'
import { STORE_DOMAIN } from '../shopify/schemas.ts'

const PAGE_PATHS: Partial<Record<(typeof KNOWN_PAGE_TYPES)[number], string>> = {
  index: '/',
  collection: '/collections/all',
  'list-collections': '/collections',
  cart: '/cart',
  search: '/search',
  '404': '/404',
  password: '/password',
  'customers/login': '/account/login',
  'customers/register': '/account/register',
  'customers/account': '/account',
  'customers/reset_password': '/account/reset',
  'customers/addresses': '/account/addresses',
}

export interface PreviewPage {
  pageType: (typeof KNOWN_PAGE_TYPES)[number]
  url: string
}

/** Home, then the known pages Claude named. Unknown and handle-based types are dropped. */
export function pagesToCapture(storeDomain: string, themeId: number, pageTypes: readonly string[]): PreviewPage[] {
  if (!STORE_DOMAIN.test(storeDomain) || !Number.isSafeInteger(themeId) || themeId <= 0) return []
  const wanted = ['index', ...pageTypes]
  const pages: PreviewPage[] = []
  const seen = new Set<string>()
  for (const pageType of wanted) {
    if (seen.has(pageType) || pages.length >= 6) continue
    const path = PAGE_PATHS[pageType as (typeof KNOWN_PAGE_TYPES)[number]]
    if (!path) continue
    seen.add(pageType)
    const url = new URL(path, `https://${storeDomain}`)
    url.searchParams.set('preview_theme_id', String(themeId))
    pages.push({ pageType: pageType as PreviewPage['pageType'], url: url.toString() })
  }
  return pages
}
