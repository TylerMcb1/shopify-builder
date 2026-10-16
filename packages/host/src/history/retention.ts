// Compact chats and the 30-day cutoff (README 15). Dates are calendar days, not timestamps.
export const CHAT_RETENTION_DAYS = 30
export const CHAT_NOTICE_DAYS = 3

export interface ChatLine {
  role: 'user' | 'claude'
  text: string
}

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function chatExpired(activeDay: string, today: string, days = CHAT_RETENTION_DAYS): boolean {
  return dayNumber(today) - dayNumber(activeDay) >= days
}

export function chatExpiryNotice(activeDay: string, today: string): boolean {
  const age = dayNumber(today) - dayNumber(activeDay)
  return age >= CHAT_RETENTION_DAYS - CHAT_NOTICE_DAYS && age < CHAT_RETENTION_DAYS
}

/** Keeps who spoke and the text. Drops progress, tool calls, and empty lines. */
export function compactChat(events: readonly { type: string; text?: string; summary?: string }[]): ChatLine[] {
  const lines: ChatLine[] = []
  for (const event of events) {
    if (event.type === 'user' && event.text?.trim()) lines.push({ role: 'user', text: event.text.trim() })
    if ((event.type === 'assistant' || event.type === 'question' || event.type === 'step_ready') && (event.text ?? event.summary)?.trim()) {
      lines.push({ role: 'claude', text: (event.text ?? event.summary ?? '').trim() })
    }
  }
  return lines
}

function dayNumber(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return 0
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000)
}
