// Plain explanation when a saved change cannot be reverted yet (README 8.7).
export function undoConflictMessage(titles: readonly string[]): string {
  const unique = [...new Set(titles.map((title) => title.trim()).filter(Boolean))].slice(0, 5)
  if (unique.length === 0) return 'Later changes use the same files. Undo those changes first.'
  return `Later changes use the same files. Undo these first: ${unique.join(', ')}.`
}

export const GO_LIVE_STEPS = [
  'Open Online Store, then Themes, in Shopify admin.',
  'Find this theme by name and open its menu.',
  'Choose Publish.',
  'Come back here. Shopify Builder will notice when your working copy is live.',
] as const
