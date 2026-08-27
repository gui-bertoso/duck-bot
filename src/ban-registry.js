import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(new URL('../data/bans.json', import.meta.url));
let records = [];
let saving = Promise.resolve();

export async function loadBanRegistry() {
  try {
    records = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    records = [];
  }
}

export async function registerBan(data) {
  const previous = records.find((item) => item.guildId === data.guildId && item.userId === data.userId && item.status === 'active');
  if (previous) {
    Object.assign(previous, data, { bannedAt: new Date().toISOString() });
    await save();
    return previous;
  }

  const record = {
    id: `${Date.now().toString(36)}-${data.userId}`,
    status: 'active',
    bannedAt: new Date().toISOString(),
    ...data,
  };
  records.push(record);
  await save();
  return record;
}

export function activeBans(guildId) {
  return records.filter((item) => item.guildId === guildId && item.status === 'active');
}

export function findActiveBan(guildId, userId) {
  return records.find((item) => item.guildId === guildId && item.userId === userId && item.status === 'active');
}

export function findLatestBan(guildId, userId) {
  return [...records].reverse().find((item) => item.guildId === guildId && item.userId === userId);
}

export async function registerUnban(guildId, userId, moderatorId, unbanReason) {
  const record = findActiveBan(guildId, userId);
  if (!record) return null;
  Object.assign(record, {
    status: 'revoked',
    unbannedAt: new Date().toISOString(),
    unbannedBy: moderatorId,
    unbanReason,
  });
  await save();
  return record;
}

async function save() {
  saving = saving.then(async () => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  });
  return saving;
}
