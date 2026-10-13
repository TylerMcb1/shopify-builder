import type { ShopifyBuilderApi } from '../preload/index.ts'

declare global {
  interface Window {
    shopifyBuilder?: ShopifyBuilderApi
  }
}

export {}
