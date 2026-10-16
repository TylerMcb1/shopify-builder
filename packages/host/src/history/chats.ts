// Chat rows in the same SQLite file as the other records. Secrets never go here (README 15, 19).
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chatExpired, type ChatLine } from './retention.ts'

export interface ChatRecord {
  chatId: string
  themeId: number
  title: string
  activeDay: string
  messages: ChatLine[]
}

export function openChats(userDataDir: string) {
  if (!path.isAbsolute(userDataDir)) throw new Error('userDataDir must be absolute')
  mkdirSync(userDataDir, { recursive: true })
  const db = new DatabaseSync(path.join(userDataDir, 'records.sqlite'))
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      chat_id TEXT PRIMARY KEY,
      theme_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      active_day TEXT NOT NULL,
      messages_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  return {
    saveChat(record: ChatRecord) {
      db.prepare(
        `INSERT INTO chats (chat_id, theme_id, title, active_day, messages_json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (chat_id) DO UPDATE SET title = excluded.title, active_day = excluded.active_day, messages_json = excluded.messages_json`,
      ).run(record.chatId, record.themeId, record.title, record.activeDay, JSON.stringify(record.messages))
    },
    listChats(): ChatRecord[] {
      return db
        .prepare('SELECT * FROM chats ORDER BY active_day DESC, chat_id DESC')
        .all()
        .map(chatFrom)
    },
    deleteChat(chatId: string) {
      db.prepare('DELETE FROM chats WHERE chat_id = ?').run(chatId)
    },
    /** Deletes chats whose last activity is 30 days old or older. Returns the removed ids. */
    applyRetention(today: string): string[] {
      const stale = this.listChats().filter((chat) => chatExpired(chat.activeDay, today))
      for (const chat of stale) this.deleteChat(chat.chatId)
      try {
        db.exec('VACUUM')
      } catch {
        // Another connection may be reading this file. The rows are already gone.
      }
      return stale.map((chat) => chat.chatId)
    },
    getSetting(key: string): string | null {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
      return row && typeof row.value === 'string' ? row.value : null
    },
    setSetting(key: string, value: string) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
    },
    clearSetting(key: string) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    },
  }
}

function chatFrom(row: Record<string, unknown>): ChatRecord {
  const parsed: unknown = JSON.parse(String(row.messages_json))
  const messages = Array.isArray(parsed)
    ? parsed.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const record = item as { role?: unknown; text?: unknown }
        const role: ChatLine['role'] | null = record.role === 'user' ? 'user' : record.role === 'claude' ? 'claude' : null
        if (!role || typeof record.text !== 'string') return []
        return [{ role, text: record.text }]
      })
    : []
  return {
    chatId: String(row.chat_id),
    themeId: Number(row.theme_id),
    title: String(row.title),
    activeDay: String(row.active_day),
    messages,
  }
}
