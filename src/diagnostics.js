import { PermissionFlagsBits } from 'discord.js';
import { db, getSettings } from './database.js';

const REQUIRED_PERMISSIONS = [
  ['View channels', PermissionFlagsBits.ViewChannel],
  ['Send messages', PermissionFlagsBits.SendMessages],
  ['Inserir links', PermissionFlagsBits.EmbedLinks],
  ['Message history', PermissionFlagsBits.ReadMessageHistory],
  ['Manage messages', PermissionFlagsBits.ManageMessages],
  ['Moderate members', PermissionFlagsBits.ModerateMembers],
  ['Kick members', PermissionFlagsBits.KickMembers],
  ['Ban members', PermissionFlagsBits.BanMembers],
  ['Manage roles', PermissionFlagsBits.ManageRoles],
  ['Deafen members', PermissionFlagsBits.DeafenMembers],
];

export function diagnoseGuild(guild) {
  const botMember = guild.members.me;
  const settings = getSettings(guild.id);
  const permissions = REQUIRED_PERMISSIONS.map(([name, permission]) => ({
    name,
    ok: Boolean(botMember?.permissions.has(permission)),
  }));
  const channelTargets = [
    ['log-bot', settings.logChannelId],
    ['tribunal', settings.tribunalChannelId],
    ['controle-bot', settings.commandChannelId],
  ];
  const channels = channelTargets.map(([name, configuredId]) => {
    const channel =
      guild.channels.cache.get(configuredId) ??
      guild.channels.cache.find((item) => item.name === name);
    const canWrite =
      channel?.isTextBased() &&
      channel
        .permissionsFor(botMember)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
    return { name, ok: Boolean(canWrite) };
  });

  let databaseOk = true;
  try {
    db.prepare('SELECT 1').get();
  } catch {
    databaseOk = false;
  }

  const rolePositionOk = Boolean(
    botMember && botMember.roles.highest.position > guild.roles.everyone.position,
  );
  const failures = [
    ...permissions.filter((item) => !item.ok).map((item) => item.name),
    ...channels.filter((item) => !item.ok).map((item) => `channel #${item.name}`),
    ...(!databaseOk ? ['database'] : []),
  ];

  return { permissions, channels, databaseOk, rolePositionOk, failures };
}

export function formatDiagnostic(result) {
  const line = (item) => `${item.ok ? '✅' : '❌'} ${item.name}`;
  return {
    permissions: result.permissions.map(line).join('\n'),
    channels: result.channels.map(line).join('\n'),
    summary: result.failures.length
      ? `⚠️ ${result.failures.length} issue(s) found.`
      : '✅ Duck Bot is ready to moderate.',
  };
}
