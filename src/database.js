import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const databasePath = join(dataDir, 'duck-bot.db');
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS settings(guild_id TEXT PRIMARY KEY,data TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS warnings(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,moderator_id TEXT,source TEXT,acknowledged INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,expires_at TEXT,data TEXT NOT NULL DEFAULT '{}');
  CREATE INDEX IF NOT EXISTS warnings_active ON warnings(guild_id,user_id,status);
  CREATE TABLE IF NOT EXISTS tribunal_cases(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT,data TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS tribunal_votes(case_id TEXT NOT NULL,judge_id TEXT NOT NULL,verdict TEXT NOT NULL,reason TEXT,created_at TEXT NOT NULL,PRIMARY KEY(case_id,judge_id));
  CREATE TABLE IF NOT EXISTS bans(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,banned_at TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}');
  CREATE INDEX IF NOT EXISTS bans_active ON bans(guild_id,user_id,status);
  CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT NOT NULL,event_type TEXT NOT NULL,user_id TEXT,created_at TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}');
  CREATE INDEX IF NOT EXISTS audit_user ON audit_events(guild_id,user_id,created_at);
  CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,reporter_id TEXT NOT NULL,target_id TEXT,reason TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS message_history(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,channel_id TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS message_history_user ON message_history(guild_id,user_id,created_at);
`);

ensureColumn('reports', 'data', "TEXT NOT NULL DEFAULT '{}'");

export const DEFAULT_SETTINGS = Object.freeze({
  automodLevel: 'normal',
  warningExpiryDays: 30,
  warningThreshold: 3,
  messageRetentionDays: 30,
  messageHistoryEnabled: true,
  raidJoinCount: 8,
  raidWindowSeconds: 20,
  minimumAccountAgeDays: 3,
  lockdown: false,
  welcomeMessage: 'Welcome, {user}, to {server}! 🦆',
  exemptRoleIds: [],
  exemptChannelIds: [],
  allowedDomains: [],
  logChannelId: null,
  tribunalChannelId: null,
  commandChannelId: null,
});

function ensureColumn(table, column, definition) {
  const exists = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((item) => item.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function getSettings(guildId) {
  const row = db.prepare('SELECT data FROM settings WHERE guild_id=?').get(guildId);
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.data) : {}) };
}
export function updateSettings(guildId, patch) {
  const value = { ...getSettings(guildId), ...patch };
  db.prepare(
    'INSERT INTO settings VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data',
  ).run(guildId, JSON.stringify(value));
  return value;
}
export function audit(guildId, eventType, userId, data = {}) {
  db.prepare(
    'INSERT INTO audit_events(guild_id,event_type,user_id,created_at,data) VALUES(?,?,?,?,?)',
  ).run(guildId, eventType, userId ?? null, new Date().toISOString(), JSON.stringify(data));
}
export function userAudit(guildId, userId, limit = 50) {
  return db
    .prepare('SELECT * FROM audit_events WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT ?')
    .all(guildId, userId, limit)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
}
export function backupDatabase() {
  const dir = fileURLToPath(new URL('../backups/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const target = join(dir, `duck-bot-${new Date().toISOString().slice(0, 10)}.db`);
  copyFileSync(databasePath, target);
  return target;
}
export function migrateJsonOnce() {
  if (db.prepare("SELECT 1 FROM settings WHERE guild_id='__migration__'").get()) return;
  migrate('warnings.json', importWarning);
  migrate('tribunal.json', importCase);
  migrate('bans.json', importBan);
  db.prepare("INSERT INTO settings VALUES('__migration__','{}')").run();
}
function migrate(name, fn) {
  const path = join(dataDir, name);
  if (existsSync(path)) for (const item of JSON.parse(readFileSync(path, 'utf8'))) fn(item);
}
function importWarning(i) {
  db.prepare('INSERT OR IGNORE INTO warnings VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    i.id,
    i.guildId,
    i.userId,
    i.status,
    i.reason,
    i.moderatorId ?? null,
    i.source ?? null,
    i.acknowledged ? 1 : 0,
    i.createdAt,
    i.expiresAt ?? null,
    JSON.stringify(i),
  );
}
function importCase(i) {
  db.prepare('INSERT OR IGNORE INTO tribunal_cases VALUES(?,?,?,?,?,?,?,?)').run(
    i.id,
    i.guildId,
    i.userId,
    i.status,
    i.type,
    i.createdAt,
    i.expiresAt ?? null,
    JSON.stringify(i),
  );
}
function importBan(i) {
  db.prepare('INSERT OR IGNORE INTO bans VALUES(?,?,?,?,?,?,?)').run(
    i.id,
    i.guildId,
    i.userId,
    i.status,
    i.reason,
    i.bannedAt,
    JSON.stringify(i),
  );
}
