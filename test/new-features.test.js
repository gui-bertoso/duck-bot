import assert from 'node:assert/strict';
import test from 'node:test';
import { db, updateSettings } from '../src/database.js';
import { getMessageHistory, rememberMessage } from '../src/message-history.js';
import { decideAutomaticAction } from '../src/punishment-policy.js';
import { createCase, joinQueue, voteCase } from '../src/tribunal.js';

const guildId = 'test-new-features';
const userId = 'test-member';

test.beforeEach(() => {
  db.prepare('DELETE FROM message_history WHERE guild_id=?').run(guildId);
  db.prepare(
    'DELETE FROM tribunal_votes WHERE case_id IN (SELECT id FROM tribunal_cases WHERE guild_id=?)',
  ).run(guildId);
  db.prepare('DELETE FROM tribunal_cases WHERE guild_id=?').run(guildId);
  db.prepare('DELETE FROM settings WHERE guild_id=?').run(guildId);
});

test('persists message history beyond the event lifetime', () => {
  updateSettings(guildId, { messageHistoryEnabled: true, messageRetentionDays: 30 });
  rememberMessage({
    id: 'message-1',
    guild: { id: guildId },
    author: { id: userId },
    channel: { id: 'channel-1' },
    content: 'mensagem usada como evidência',
    createdAt: new Date(),
  });

  const history = getMessageHistory(guildId, userId);
  assert.equal(history.length, 1);
  assert.equal(history[0].content, 'mensagem usada como evidência');
});

test('escalates sanctions using the configured score', () => {
  const violation = { type: 'spam', severity: 2 };
  assert.equal(decideAutomaticAction({ points: 1, violation, threshold: 3 }).type, 'warning');
  assert.equal(decideAutomaticAction({ points: 3, violation, threshold: 3 }).minutes, 10);
  assert.equal(decideAutomaticAction({ points: 5, violation, threshold: 3 }).minutes, 60);
  assert.equal(
    decideAutomaticAction({
      points: 5,
      violation: { type: 'phishing', severity: 5 },
      threshold: 3,
    }).type,
    'ban',
  );
});

test('prevents the accused from voting on their own case', async () => {
  const item = await createCase({ guildId, userId, type: 'spam' });
  await joinQueue(item.id, userId);
  await assert.rejects(() => voteCase(item.id, userId, 'inocente', 'autovoto'), /their own case/);
});
