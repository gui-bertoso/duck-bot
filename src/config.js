import { PermissionFlagsBits } from 'discord.js';

const VALID_BOT_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);

export const botStatus = VALID_BOT_STATUSES.has(process.env.BOT_STATUS)
  ? process.env.BOT_STATUS
  : 'invisible';

export const allowedDomains = (process.env.ALLOWED_DOMAINS ?? '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);

export const commandPermissions = new Map([
  ['limpar', PermissionFlagsBits.ManageMessages],
  ['expulsar', PermissionFlagsBits.KickMembers],
  ['banir', PermissionFlagsBits.BanMembers],
  ['timeout', PermissionFlagsBits.ModerateMembers],
  ['untimeout', PermissionFlagsBits.ModerateMembers],
  ['tribunal-fila', PermissionFlagsBits.ModerateMembers],
  ['julgar', PermissionFlagsBits.ModerateMembers],
  ['avisar', PermissionFlagsBits.ModerateMembers],
  ['avisos', PermissionFlagsBits.ModerateMembers],
  ['remover-aviso', PermissionFlagsBits.ModerateMembers],
  ['banidos', PermissionFlagsBits.BanMembers],
  ['desbanir', PermissionFlagsBits.BanMembers],
  ['historico-ban', PermissionFlagsBits.BanMembers],
  ['status', PermissionFlagsBits.ManageGuild],
  ['config', PermissionFlagsBits.ManageGuild],
  ['lockdown', PermissionFlagsBits.ManageGuild],
  ['painel', PermissionFlagsBits.ManageGuild],
  ['limpar-warnings', PermissionFlagsBits.ManageGuild],
  ['relatorio', PermissionFlagsBits.ModerateMembers],
  ['backup', PermissionFlagsBits.Administrator],
  ['diagnostico', PermissionFlagsBits.ManageGuild],
  ['setup-inicial', PermissionFlagsBits.Administrator],
  ['moderar-voz', PermissionFlagsBits.DeafenMembers],
  ['cargo-apoiador', PermissionFlagsBits.ManageRoles],
]);
