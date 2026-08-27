import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(new URL('../data/warnings.json', import.meta.url));
let warnings = [];
let saving = Promise.resolve();

export async function loadWarnings() {
  try {
    warnings = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    warnings = [];
  }
}

export async function addWarning(data) {
  const warning = {
    id: Date.now().toString(36),
    status: 'active',
    acknowledged: false,
    createdAt: new Date().toISOString(),
    ...data,
  };
  warnings.push(warning);
  await save();
  return { warning, activeCount: activeWarnings(data.guildId, data.userId).length };
}

export function activeWarnings(guildId, userId) {
  return warnings.filter((item) => item.guildId === guildId && item.userId === userId && item.status === 'active');
}

export async function acknowledgeWarning(id, userId) {
  const warning = warnings.find((item) => item.id === id && item.userId === userId && item.status === 'active');
  if (!warning) return null;
  warning.acknowledged = true;
  warning.acknowledgedAt = new Date().toISOString();
  await save();
  return warning;
}

export async function revokeWarning(guildId, id, moderatorId, reason) {
  const warning = warnings.find((item) => item.guildId === guildId && item.id === id && item.status === 'active');
  if (!warning) return null;
  Object.assign(warning, {
    status: 'revoked',
    revokedAt: new Date().toISOString(),
    revokedBy: moderatorId,
    revokeReason: reason,
  });
  await save();
  return warning;
}

async function save() {
  saving = saving.then(async () => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(warnings, null, 2)}\n`, 'utf8');
  });
  return saving;
}
