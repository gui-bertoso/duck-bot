import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = new URL('../data/tribunal.json', import.meta.url);
const filePath = fileURLToPath(file);
let cases = [];
let saving = Promise.resolve();

export async function loadTribunal() {
  try {
    cases = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    cases = [];
  }
}

export async function createCase(data) {
  const open = cases.find((item) => item.guildId === data.guildId && item.userId === data.userId && item.status !== 'closed');
  if (open) return open;

  const item = {
    id: `${Date.now().toString(36)}-${data.userId}`,
    status: 'offered',
    createdAt: new Date().toISOString(),
    ...data,
  };
  cases.push(item);
  await save();
  return item;
}

export async function joinQueue(caseId, userId) {
  const item = cases.find((entry) => entry.id === caseId && entry.userId === userId);
  if (!item || item.status === 'closed') return null;
  item.status = 'queued';
  item.queuedAt = new Date().toISOString();
  await save();
  return item;
}

export function queuedCases(guildId) {
  return cases.filter((item) => item.guildId === guildId && item.status === 'queued');
}

export async function closeCase(guildId, userId, verdict, judgeId, reason) {
  const item = cases.find((entry) => entry.guildId === guildId && entry.userId === userId && entry.status === 'queued');
  if (!item) return null;
  Object.assign(item, { status: 'closed', verdict, judgeId, reason, closedAt: new Date().toISOString() });
  await save();
  return item;
}

async function save() {
  saving = saving.then(async () => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(cases, null, 2)}\n`, 'utf8');
  });
  return saving;
}
