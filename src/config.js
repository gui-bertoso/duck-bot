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
  ['clear', PermissionFlagsBits.ManageMessages],
  ['kick', PermissionFlagsBits.KickMembers],
  ['ban', PermissionFlagsBits.BanMembers],
  ['timeout', PermissionFlagsBits.ModerateMembers],
  ['untimeout', PermissionFlagsBits.ModerateMembers],
  ['tribunal-queue', PermissionFlagsBits.ModerateMembers],
  ['judge', PermissionFlagsBits.ModerateMembers],
  ['warn', PermissionFlagsBits.ModerateMembers],
  ['warnings', PermissionFlagsBits.ModerateMembers],
  ['remove-warning', PermissionFlagsBits.ModerateMembers],
  ['bans', PermissionFlagsBits.BanMembers],
  ['unban', PermissionFlagsBits.BanMembers],
  ['ban-history', PermissionFlagsBits.BanMembers],
  ['status', PermissionFlagsBits.ManageGuild],
  ['config', PermissionFlagsBits.ManageGuild],
  ['lockdown', PermissionFlagsBits.ManageGuild],
  ['panel', PermissionFlagsBits.ManageGuild],
  ['clear-warnings', PermissionFlagsBits.ManageGuild],
  ['audit', PermissionFlagsBits.ModerateMembers],
  ['backup', PermissionFlagsBits.Administrator],
  ['diagnostics', PermissionFlagsBits.ManageGuild],
  ['setup', PermissionFlagsBits.Administrator],
  ['voice-moderation', PermissionFlagsBits.DeafenMembers],
  ['supporter-role', PermissionFlagsBits.ManageRoles],
]);
