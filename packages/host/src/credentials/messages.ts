// Plain-language credential results (README 7.1, 22).
export const CREDENTIAL_MESSAGES = {
  badKey: "That key didn't work. Please check it and try again.",
  offline: "Couldn't reach Anthropic. Please check your internet connection.",
  connected: 'Claude connected',
  removed: 'Claude disconnected.',
  decryptFailed: 'Enter your API key again. This computer could not unlock the saved key.',
  unavailable: "This computer can't store a key safely yet.",
  storeSaved: 'Store connected.',
  storeFailed: 'Shopify Builder could not connect to your store.',
  storeRemoved: 'Store disconnected.',
  connectClaude: 'Connect Claude before starting a change.',
} as const
