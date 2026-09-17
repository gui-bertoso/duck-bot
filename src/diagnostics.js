import { PermissionFlagsBits } from 'discord.js';
import { db, getSettings } from './database.js';

const REQUIRED_PERMISSIONS = [
  ['Ver canais', PermissionFlagsBits.ViewChannel],
  ['Enviar mensagens', PermissionFlagsBits.SendMessages],
  ['Inserir links', PermissionFlagsBits.EmbedLinks],
  ['Histórico de mensagens', PermissionFlagsBits.ReadMessageHistory],
  ['Gerenciar mensagens', PermissionFlagsBits.ManageMessages],
  ['Moderar membros', PermissionFlagsBits.ModerateMembers],
  ['Expulsar membros', PermissionFlagsBits.KickMembers],
  ['Banir membros', PermissionFlagsBits.BanMembers],
  ['Gerenciar cargos', PermissionFlagsBits.ManageRoles],
  ['Ensurdecer membros', PermissionFlagsBits.DeafenMembers],
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
    ...channels.filter((item) => !item.ok).map((item) => `canal #${item.name}`),
    ...(!databaseOk ? ['banco de dados'] : []),
  ];

  return { permissions, channels, databaseOk, rolePositionOk, failures };
}

export function formatDiagnostic(result) {
  const line = (item) => `${item.ok ? '✅' : '❌'} ${item.name}`;
  return {
    permissions: result.permissions.map(line).join('\n'),
    channels: result.channels.map(line).join('\n'),
    summary: result.failures.length
      ? `⚠️ ${result.failures.length} problema(s) encontrado(s).`
      : '✅ O Duck Bot está pronto para moderar.',
  };
}
