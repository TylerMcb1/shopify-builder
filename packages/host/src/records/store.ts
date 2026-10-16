// SQLite records that are not secrets (README 12.4, 19). Credentials never go in this file.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type ThemeKind = 'working-copy' | 'named-copy' | 'adopted' | 'preview'

export interface OwnershipRecord {
  storeId: string
  themeId: number
  kind: ThemeKind
  name: string
  originThemeId: number | null
  retired: boolean
}

export interface ChangeRecord {
  changeId: string
  storeId: string
  themeId: number
  commitId: string
  title: string
  sensitiveFiles: string[]
}

export interface Records {
  getOwnership(storeId: string, themeId: number): OwnershipRecord | null
  getPreview(storeId: string): OwnershipRecord | null
  saveOwnership(record: OwnershipRecord): void
  retire(storeId: string, themeId: number): void
  getBaseline(commitId: string): import('../validation/theme-check.ts').Offense[] | null
  saveBaseline(commitId: string, offenses: import('../validation/theme-check.ts').Offense[]): void
  saveChange(record: ChangeRecord): void
  getChange(changeId: string): ChangeRecord | null
  listChanges(storeId: string): ChangeRecord[]
  listOwnership(storeId: string): OwnershipRecord[]
  saveIncident(id: string, storeId: string, themeId: number, message: string, pushed: readonly string[]): void
  /** A save that was still running when the app stopped. */
  openJob(themeKey: string, sessionId: string): void
  clearJob(themeKey: string): void
  getJob(themeKey: string): { sessionId: string } | null
}

export function openRecords(userDataDir: string): Records {
  if (!path.isAbsolute(userDataDir)) throw new Error('userDataDir must be absolute')
  mkdirSync(userDataDir, { recursive: true })
  const db = new DatabaseSync(path.join(userDataDir, 'records.sqlite'))
  db.exec(`
    CREATE TABLE IF NOT EXISTS ownership (
      store_id TEXT NOT NULL,
      theme_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      origin_theme_id INTEGER,
      retired INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (store_id, theme_id)
    );
    CREATE TABLE IF NOT EXISTS baselines (
      commit_id TEXT PRIMARY KEY,
      offenses_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS changes (
      change_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      theme_id INTEGER NOT NULL,
      commit_id TEXT NOT NULL,
      title TEXT NOT NULL,
      sensitive_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      theme_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      pushed_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      theme_key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
  `)

  return {
    getPreview(storeId: string): OwnershipRecord | null {
      const row = db
        .prepare(`SELECT * FROM ownership WHERE store_id = ? AND kind = 'preview' AND retired = 0 ORDER BY theme_id DESC LIMIT 1`)
        .get(storeId)
      return row ? ownershipFrom(row) : null
    },
    getOwnership(storeId, themeId) {
      const row = db.prepare('SELECT * FROM ownership WHERE store_id = ? AND theme_id = ?').get(storeId, themeId)
      return row ? ownershipFrom(row) : null
    },
    saveOwnership(record) {
      db.prepare(
        `INSERT INTO ownership (store_id, theme_id, kind, name, origin_theme_id, retired)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (store_id, theme_id) DO UPDATE SET
           kind = excluded.kind, name = excluded.name, origin_theme_id = excluded.origin_theme_id, retired = excluded.retired`,
      ).run(record.storeId, record.themeId, record.kind, record.name, record.originThemeId, record.retired ? 1 : 0)
    },
    retire(storeId, themeId) {
      db.prepare('UPDATE ownership SET retired = 1 WHERE store_id = ? AND theme_id = ?').run(storeId, themeId)
    },
    getBaseline(commitId) {
      const row = db.prepare('SELECT offenses_json FROM baselines WHERE commit_id = ?').get(commitId)
      if (!row || typeof row.offenses_json !== 'string') return null
      const parsed: unknown = JSON.parse(row.offenses_json)
      return Array.isArray(parsed) ? (parsed as import('../validation/theme-check.ts').Offense[]) : null
    },
    saveBaseline(commitId, offenses) {
      db.prepare(
        `INSERT INTO baselines (commit_id, offenses_json) VALUES (?, ?)
         ON CONFLICT (commit_id) DO UPDATE SET offenses_json = excluded.offenses_json`,
      ).run(commitId, JSON.stringify(offenses))
    },
    saveChange(record) {
      db.prepare(
        `INSERT INTO changes (change_id, store_id, theme_id, commit_id, title, sensitive_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(record.changeId, record.storeId, record.themeId, record.commitId, record.title, JSON.stringify(record.sensitiveFiles))
    },
    getChange(changeId) {
      const row = db.prepare('SELECT * FROM changes WHERE change_id = ?').get(changeId)
      if (!row) return null
      const sensitive: unknown = JSON.parse(String(row.sensitive_json))
      return {
        changeId: String(row.change_id),
        storeId: String(row.store_id),
        themeId: Number(row.theme_id),
        commitId: String(row.commit_id),
        title: String(row.title),
        sensitiveFiles: Array.isArray(sensitive) ? sensitive.filter((item) => typeof item === 'string') : [],
      }
    },
    listChanges(storeId) {
      return db
        .prepare('SELECT * FROM changes WHERE store_id = ? ORDER BY rowid DESC')
        .all(storeId)
        .map(changeFrom)
    },
    listOwnership(storeId) {
      return db
        .prepare('SELECT * FROM ownership WHERE store_id = ?')
        .all(storeId)
        .map(ownershipFrom)
    },
    saveIncident(id, storeId, themeId, message, pushed) {
      db.prepare('INSERT INTO incidents (id, store_id, theme_id, message, pushed_json) VALUES (?, ?, ?, ?, ?)').run(
        id,
        storeId,
        themeId,
        message,
        JSON.stringify(pushed),
      )
    },
    openJob(themeKey, sessionId) {
      db.prepare(
        `INSERT INTO jobs (theme_key, session_id) VALUES (?, ?)
         ON CONFLICT (theme_key) DO UPDATE SET session_id = excluded.session_id`,
      ).run(themeKey, sessionId)
    },
    clearJob(themeKey) {
      db.prepare('DELETE FROM jobs WHERE theme_key = ?').run(themeKey)
    },
    getJob(themeKey) {
      const row = db.prepare('SELECT session_id FROM jobs WHERE theme_key = ?').get(themeKey)
      if (!row || typeof row.session_id !== 'string') return null
      return { sessionId: row.session_id }
    },
  }
}

function changeFrom(row: Record<string, unknown>): ChangeRecord {
  const sensitive: unknown = JSON.parse(String(row.sensitive_json))
  return {
    changeId: String(row.change_id),
    storeId: String(row.store_id),
    themeId: Number(row.theme_id),
    commitId: String(row.commit_id),
    title: String(row.title),
    sensitiveFiles: Array.isArray(sensitive) ? sensitive.filter((item) => typeof item === 'string') : [],
  }
}

function ownershipFrom(row: Record<string, unknown>): OwnershipRecord {
  return {
    storeId: String(row.store_id),
    themeId: Number(row.theme_id),
    kind: row.kind as ThemeKind,
    name: String(row.name),
    originThemeId: row.origin_theme_id == null ? null : Number(row.origin_theme_id),
    retired: Number(row.retired) === 1,
  }
}
