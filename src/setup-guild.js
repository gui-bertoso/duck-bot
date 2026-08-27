import {
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';

export async function setupGuild(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe();

  let botRole = guild.roles.cache.find((role) => role.name === 'Bot');
  if (!botRole) {
    botRole = await guild.roles.create({
      name: 'Bot',
      color: 0xf4c430,
      reason: 'Configuração automática do Duck Bot',
    });
  }

  if (!me.roles.cache.has(botRole.id)) {
    await me.roles.add(botRole, 'Cargo padrão do Duck Bot');
  }

  let logChannel = guild.channels.cache.find(
    (channel) => channel.name === 'log-bot' && channel.type === ChannelType.GuildText,
  );

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: 'log-bot',
      type: ChannelType.GuildText,
      topic: 'Registros automáticos do Duck Bot.',
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
      ],
      reason: 'Canal de registros do Duck Bot',
    });
  }

  return logChannel;
}
