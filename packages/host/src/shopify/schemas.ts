// Zod validation of Shopify container output (README 4: validate all container output).
import { z } from 'zod'

export const STORE_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/

export const ThemeSchema = z.object({
  id: z.number().int().positive().refine(Number.isSafeInteger),
  name: z.string().max(255),
  role: z.string().min(1).max(32),
})

export type Theme = z.infer<typeof ThemeSchema>

export const ThemeListSchema = z
  .array(ThemeSchema)
  .max(1000)
  .refine((themes) => new Set(themes.map((t) => t.id)).size === themes.length, 'duplicate theme ids')

export function parseThemeList(stdout: string): Theme[] {
  let value: unknown
  try {
    value = JSON.parse(stdout.trim())
  } catch {
    throw new Error('theme list is not JSON')
  }
  const result = ThemeListSchema.safeParse(value)
  if (!result.success) throw new Error(`theme list failed validation: ${result.error.issues[0]?.message ?? 'invalid'}`)
  return result.data
}
