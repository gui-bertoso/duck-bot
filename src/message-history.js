import { db, getSettings } from './database.js';

const MAX_MESSAGES_PER_USER = 30;
const MAX_MESSAGE_LENGTH = 1_000;

export function rememberMessage(message) {
  const settings = getSettings(message.guild.id);
  if (!settings.messageHistoryEnabled) return;

  db.prepare(
    `INSERT OR REPLACE INTO message_history
      (id,guild_id,user_id,channel_id,content,created_at)
     VALUES(?,?,?,?,?,?)`,
  ).run(
    message.id,
    message.guild.id,
    message.author.id,
    message.channel.id,
    message.content.slice(0, MAX_MESSAGE_LENGTH),
    message.createdAt.toISOString(),
  );

  db.prepare(
    `DELETE FROM message_history
     WHERE guild_id=? AND user_id=? AND id NOT IN (
       SELECT id FROM message_history
       WHERE guild_id=? AND user_id=?
       ORDER BY created_at DESC LIMIT ?
     )`,
  ).run(
    message.guild.id,
    message.author.id,
    message.guild.id,
    message.author.id,
    MAX_MESSAGES_PER_USER,
  );
}

export function getMessageHistory(guildId, userId) {
  pruneMessageHistory(guildId);
  return db
    .prepare(
      `SELECT id AS messageId,channel_id AS channelId,content,created_at AS createdAt
       FROM message_history
       WHERE guild_id=? AND user_id=?
       ORDER BY created_at`,
    )
    .all(guildId, userId);
}

export function pruneMessageHistory(guildId) {
  const retentionDays = getSettings(guildId).messageRetentionDays;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  return Number(
    db.prepare('DELETE FROM message_history WHERE guild_id=? AND created_at<?').run(guildId, cutoff)
      .changes,
  );
}
