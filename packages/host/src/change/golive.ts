// Readiness for a manual publish the user performs in Shopify (README 8.6).
export interface GoLiveItem {
  id: 'saved' | 'check' | 'live' | 'preview'
  label: string
  passed: boolean
  detail: string
}

export function goLiveChecklist(input: {
  unsaved: boolean
  blocking: number
  liveChanges: readonly string[]
  previewReady: boolean
}): GoLiveItem[] {
  return [
    {
      id: 'saved',
      label: 'All changes saved',
      passed: !input.unsaved,
      detail: input.unsaved ? 'Save or discard the open change first.' : 'Nothing is waiting to be saved.',
    },
    {
      id: 'check',
      label: 'No new theme errors',
      passed: input.blocking === 0,
      detail: input.blocking === 0 ? 'Theme Check found no new errors.' : `${input.blocking} new errors need to be fixed first.`,
    },
    {
      id: 'live',
      label: 'Live theme changes',
      passed: input.liveChanges.length === 0,
      detail:
        input.liveChanges.length === 0
          ? 'The live theme has no newer edits to bring in.'
          : `The live theme changed ${input.liveChanges.length} file${input.liveChanges.length === 1 ? '' : 's'} since this copy was made.`,
    },
    {
      id: 'preview',
      label: 'Fresh preview',
      passed: input.previewReady,
      detail: input.previewReady
        ? 'A fresh preview was captured.'
        : 'A fresh preview could not be captured. Look the theme over before continuing.',
    },
  ]
}

export interface RoleChange {
  wentLive: { themeId: number; name: string } | null
  rollback: { themeId: number; name: string } | null
  liveThemeId: number | null
}

/** A working copy that became live is retired. The theme it replaced is kept for rollback. */
export function detectRoleChanges(input: {
  previousLiveId: number | null
  ownership: readonly { themeId: number; kind: string; retired: boolean; name: string }[]
  themes: readonly { id: number; role: string; name: string }[]
}): RoleChange {
  const live = input.themes.find((theme) => theme.role === 'live') ?? null
  const owned = input.ownership.find((record) => !record.retired && record.kind !== 'preview' && live && record.themeId === live.id)
  const wentLive = owned ? { themeId: owned.themeId, name: live?.name ?? owned.name } : null
  const previous = input.previousLiveId == null ? null : input.themes.find((theme) => theme.id === input.previousLiveId)
  const rollback =
    wentLive && previous && previous.id !== wentLive.themeId && previous.role !== 'live'
      ? { themeId: previous.id, name: previous.name }
      : null
  return { wentLive, rollback, liveThemeId: live?.id ?? input.previousLiveId }
}
