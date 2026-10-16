// MVP palette (README 16). Components use these names through the Tailwind theme, not raw hex in TSX.
export const palette = {
  primary: '#008060',
  primaryHover: '#006E52',
  primarySubtle: '#E3F1DF',
  background: '#F6F6F7',
  surface: '#FFFFFF',
  textPrimary: '#202223',
  textSecondary: '#6D7175',
  border: '#D2D5D8',
  warning: '#B98900',
  error: '#D72C0D',
  focusRing: '#2C6ECB',
} as const

/** Dark appearance. Same roles, tuned for contrast on dark surfaces. */
export const darkPalette = {
  primary: '#1F9F74',
  primaryHover: '#27B383',
  primarySubtle: '#133328',
  background: '#161718',
  surface: '#1F2022',
  textPrimary: '#ECECED',
  textSecondary: '#9C9EA3',
  border: '#34363A',
  warning: '#E2B33C',
  error: '#FF6B52',
  focusRing: '#5C9DFF',
} as const
