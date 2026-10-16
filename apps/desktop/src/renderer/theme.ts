// Appearance preference. Not a secret, so it lives in the renderer's local storage.
import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const KEY = 'shopify-builder.appearance'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Storage can be unavailable; fall back to the system setting.
  }
  return 'system'
}

export function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia(DARK_QUERY).matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)

  useEffect(() => {
    applyTheme(preference)
    if (preference !== 'system') return
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  const update = (next: ThemePreference) => {
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // The choice still applies for this run.
    }
    setPreference(next)
  }

  return [preference, update]
}

/** macOS draws the window controls over the content, so the layout leaves room for them. */
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
