import { audit, db } from './database.js';

export async function loadTribunal() {
  archiveExpiredCases();
}
export async function createCase(data) {
  const open = db
    .prepare(
      "SELECT * FROM tribunal_cases WHERE guild_id=? AND user_id=? AND status NOT IN('closed','archived')",
    )
    .get(data.guildId, data.userId);
  if (open) return mapCase(open);
  const created = new Date();
  const item = {
    id: `${Date.now().toString(36)}-${data.userId}`,
    status: 'offered',
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + 7 * 86_400_000).toISOString(),
    ...data,
  };
  db.prepare('INSERT INTO tribunal_cases VALUES(?,?,?,?,?,?,?,?)').run(
    item.id,
    data.guildId,
    data.userId,
    item.status,
    data.type,
    item.createdAt,
    item.expiresAt,
    JSON.stringify(item),
  );
  audit(data.guildId, 'tribunal_created', data.userId, item);
  return item;
}
export async function joinQueue(id, userId) {
  const row = db
    .prepare(
      "SELECT * FROM tribunal_cases WHERE id=? AND user_id=? AND status NOT IN('closed','archived')",
    )
    .get(id, userId);
  if (!row) return null;
  db.prepare("UPDATE tribunal_cases SET status='queued' WHERE id=?").run(id);
  return { ...mapCase(row), status: 'queued' };
}
export function queuedCases(guildId) {
  archiveExpiredCases(guildId);
  return db
    .prepare(
      "SELECT * FROM tribunal_cases WHERE guild_id=? AND status='queued' ORDER BY created_at",
    )
    .all(guildId)
    .map(mapCase);
}
export function getCase(id) {
  const row = db.prepare('SELECT * FROM tribunal_cases WHERE id=?').get(id);
  return row ? mapCase(row) : null;
}
export async function voteCase(caseId, judgeId, verdict, reason) {
  const item = getCase(caseId);
  if (!item || item.status !== 'queued') throw new Error('This case is not open for voting.');
  if (item.userId === judgeId) throw new Error('The accused cannot vote on their own case.');

  db.prepare(
    'INSERT INTO tribunal_votes VALUES(?,?,?,?,?) ON CONFLICT(case_id,judge_id) DO UPDATE SET verdict=excluded.verdict,reason=excluded.reason,created_at=excluded.created_at',
  ).run(caseId, judgeId, verdict, reason, new Date().toISOString());
  return caseVotes(caseId);
}
export function caseVotes(caseId) {
  return db.prepare('SELECT * FROM tribunal_votes WHERE case_id=? ORDER BY created_at').all(caseId);
}
export async function closeCase(guildId, userId, verdict, judgeId, reason) {
  const row = db
    .prepare("SELECT * FROM tribunal_cases WHERE guild_id=? AND user_id=? AND status='queued'")
    .get(guildId, userId);
  if (!row) return null;
  const item = {
    ...mapCase(row),
    status: 'closed',
    verdict,
    judgeId,
    reason,
    closedAt: new Date().toISOString(),
  };
  db.prepare("UPDATE tribunal_cases SET status='closed',data=? WHERE id=?").run(
    JSON.stringify(item),
    row.id,
  );
  audit(guildId, 'tribunal_closed', userId, item);
  return item;
}
export function archiveExpiredCases(guildId) {
  const sql = guildId
    ? "UPDATE tribunal_cases SET status='archived' WHERE guild_id=? AND status NOT IN('closed','archived') AND expires_at<=?"
    : "UPDATE tribunal_cases SET status='archived' WHERE status NOT IN('closed','archived') AND expires_at<=?";
  return Number(
    (guildId
      ? db.prepare(sql).run(guildId, new Date().toISOString())
      : db.prepare(sql).run(new Date().toISOString())
    ).changes,
  );
}
function mapCase(row) {
  return {
    ...JSON.parse(row.data),
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
