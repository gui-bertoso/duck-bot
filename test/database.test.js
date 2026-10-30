import assert from 'node:assert/strict';
import test from 'node:test';
import { db, getSettings, updateSettings } from '../src/database.js';
import { activeWarnings, addWarning, revokeWarning } from '../src/warning-registry.js';
import { closeCase, createCase, joinQueue, queuedCases, voteCase } from '../src/tribunal.js';

const guildId = 'test-guild';
const userId = 'test-user';

test.beforeEach(() => {
  db.prepare('DELETE FROM warnings WHERE guild_id=?').run(guildId);
  db.prepare(
    'DELETE FROM tribunal_votes WHERE case_id IN (SELECT id FROM tribunal_cases WHERE guild_id=?)',
  ).run(guildId);
  db.prepare('DELETE FROM tribunal_cases WHERE guild_id=?').run(guildId);
  db.prepare('DELETE FROM settings WHERE guild_id=?').run(guildId);
});

test('merges server settings with defaults', () => {
  updateSettings(guildId, { automodLevel: 'rigido' });
  const settings = getSettings(guildId);
  assert.equal(settings.automodLevel, 'rigido');
  assert.equal(settings.warningThreshold, 3);
});

test('persists and revokes warnings', async () => {
  const { warning, activeCount } = await addWarning({
    guildId,
    userId,
    reason: 'teste',
    severity: 2,
  });
  assert.equal(activeCount, 2);
  assert.equal(activeWarnings(guildId, userId).length, 1);
  await revokeWarning(guildId, warning.id, 'judge', 'corrigido');
  assert.equal(activeWarnings(guildId, userId).length, 0);
});

test('supports case queuing, votes and verdicts', async () => {
  const item = await createCase({ guildId, userId, type: 'spam' });
  await joinQueue(item.id, userId);
  const votes = await voteCase(item.id, 'judge', 'inocente', 'ok');
  assert.equal(votes.length, 1);
  assert.equal(queuedCases(guildId).length, 1);
  const closed = await closeCase(guildId, userId, 'inocente', 'judge', 'ok');
  assert.equal(closed.status, 'closed');
});
