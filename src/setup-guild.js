import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getSettings } from './database.js';

export async function setupGuild(guild) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const settings = getSettings(guild.id);

  let botRole = guild.roles.cache.find((role) => role.name === 'Bot');
  if (!botRole) {
    botRole = await guild.roles.create({
      name: 'Bot',
      color: 0xf4c430,
      reason: 'Automatic Duck Bot setup',
    });
  }

  if (!me.roles.cache.has(botRole.id)) {
    await me.roles.add(botRole, 'Default Duck Bot role');
  }

  let logChannel =
    guild.channels.cache.get(settings.logChannelId) ??
    guild.channels.cache.find(
      (channel) => channel.name === 'log-bot' && channel.type === ChannelType.GuildText,
    );

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: 'log-bot',
      type: ChannelType.GuildText,
      topic: 'Automatic Duck Bot logs.',
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
      reason: 'Duck Bot log channel',
    });
  }

  let tribunalChannel =
    guild.channels.cache.get(settings.tribunalChannelId) ??
    guild.channels.cache.find(
      (channel) => channel.name === 'tribunal' && channel.type === ChannelType.GuildText,
    );
  if (!tribunalChannel) {
    const staffOverwrites = guild.roles.cache
      .filter((role) => role.permissions.has(PermissionFlagsBits.ModerateMembers))
      .map((role) => ({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      }));
    tribunalChannel = await guild.channels.create({
      name: 'tribunal',
      type: ChannelType.GuildText,
      topic: 'Cases and votes for the moderation team.',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        ...staffOverwrites,
      ],
      reason: 'Duck Bot tribunal',
    });
  }

  return logChannel;
}
