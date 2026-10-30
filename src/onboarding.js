import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';

const legacyRoleNames = {
  Visitor: 'Visitante',
  Member: 'Membro',
  Streams: 'Lives',
  Games: 'Jogos',
  Events: 'Eventos',
  'YouTube Member': 'Membro YouTube',
  'YouTube Subscriber': 'Inscrito YouTube',
};

export function findRole(guild, name) {
  return guild.roles.cache.find(
    (role) => role.name === name || role.name === legacyRoleNames[name],
  );
}

const roleDefinitions = [
  { name: 'Visitor', color: 0x99aab5 },
  { name: 'Member', color: 0x57f287 },
  { name: 'Streams', color: 0x9146ff, emoji: '📺', slug: 'lives' },
  { name: 'Games', color: 0x5865f2, emoji: '🎮', slug: 'jogos' },
  { name: 'Events', color: 0xfee75c, emoji: '🎉', slug: 'eventos' },
  { name: 'Twitch Sub', color: 0x9146ff },
  { name: 'YouTube Member', color: 0xff0000 },
  { name: 'YouTube Subscriber', color: 0xff6666 },
];

export async function setupOnboarding(guild, { format = 'compacto', cleanup = false } = {}) {
  const roles = {};
  for (const definition of roleDefinitions) {
    roles[definition.name] =
      findRole(guild, definition.name) ??
      (await guild.roles.create({
        name: definition.name,
        color: definition.color,
        reason: 'Initial Duck Bot setup',
      }));
  }
  const category =
    guild.channels.cache.find(
      (channel) =>
        ['START HERE', 'COMECE AQUI'].includes(channel.name) &&
        channel.type === ChannelType.GuildCategory,
    ) ??
    (await guild.channels.create({
      name: 'START HERE',
      type: ChannelType.GuildCategory,
      position: 0,
      reason: 'Initial Duck Bot setup',
    }));
  const readOnly = [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages],
    },
  ];
  let rules, welcome, rolesChannel;
  if (format === 'compacto') {
    rules = await ensureChannel(
      guild,
      category,
      'start-here',
      'Rules, verification and interest selection.',
      readOnly,
    );
    rolesChannel = rules;
    welcome = null;
    await replaceBotPanels(rules, 'onboarding-rules', rulesPanel(guild));
    await replaceBotPanels(rules, 'onboarding-roles', rolesPanel(guild));
  } else {
    rules = await ensureChannel(
      guild,
      category,
      'rules',
      'Read and accept the rules to unlock access.',
      readOnly,
    );
    welcome = await ensureChannel(guild, category, 'welcome', 'New community members.', readOnly);
    rolesChannel = await ensureChannel(
      guild,
      category,
      'choose-roles',
      'Choose the topics you want to follow.',
      readOnly,
    );
    await replaceBotPanels(rules, 'onboarding-rules', rulesPanel(guild));
    await replaceBotPanels(rolesChannel, 'onboarding-roles', rolesPanel(guild));
  }
  await organizePrivateChannels(guild);
  const removed = cleanup ? await cleanupLegacyChannels(guild, [rules?.id, rolesChannel?.id]) : [];
  return { roles, category, rules, welcome, rolesChannel, removed };
}

export async function addVisitorRole(member) {
  const role = findRole(member.guild, 'Visitor');
  if (role && member.manageable && !member.roles.cache.has(role.id))
    await member.roles.add(role, 'New member awaiting rule acceptance');
}

export async function acceptRules(guild, userId) {
  const member = await guild.members.fetch(userId);
  const visitor = findRole(guild, 'Visitor');
  const memberRole = findRole(guild, 'Member');
  if (!memberRole) throw new Error('The Member role does not exist. Run /setup.');
  if (member.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageGuild))
    return { member, bypassed: true };
  if (!member.manageable) throw new Error('My role must be above this member roles.');
  if (!member.roles.cache.has(memberRole.id)) await member.roles.add(memberRole, 'Rules accepted');
  if (visitor && member.roles.cache.has(visitor.id))
    await member.roles.remove(visitor, 'Rules accepted');
  return { member, bypassed: false };
}

export async function toggleInterestRole(guild, userId, slug) {
  const definition = roleDefinitions.find((item) => item.slug === slug);
  if (!definition) throw new Error('Invalid interest role.');
  const member = await guild.members.fetch(userId);
  const role = findRole(guild, definition.name);
  if (!role) throw new Error('Role not found. Run /setup.');
  const removing = member.roles.cache.has(role.id);
  await (removing
    ? member.roles.remove(role, 'Interest selection')
    : member.roles.add(role, 'Interest selection'));
  return { role, added: !removing };
}

function rulesPanel(guild) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`onboarding:accept:${guild.id}`)
      .setLabel('I have read and accept the rules')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xf4c430)
        .setTitle(`🦆 Welcome to ${guild.name}`)
        .setDescription(
          [
            'To keep the community welcoming:',
            '',
            '1. Respect every member.',
            '2. Do not spam or promote scams.',
            '3. Use each channel for its intended topic.',
            '4. Offensive or illegal content is not allowed.',
            '5. Follow moderator instructions.',
            '',
            'Click below to confirm and receive the **Member** role.',
          ].join('\n'),
        )
        .setFooter({ text: 'By confirming, you agree to the server rules.' }),
    ],
    components: [row],
  };
}
function rolesPanel(guild) {
  const row = new ActionRowBuilder().addComponents(
    ...roleDefinitions
      .filter((item) => item.slug)
      .map((item) =>
        new ButtonBuilder()
          .setCustomId(`onboarding:role:${guild.id}:${item.slug}`)
          .setLabel(item.name)
          .setEmoji(item.emoji)
          .setStyle(ButtonStyle.Secondary),
      ),
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Choose your interests')
        .setDescription(
          'Use the buttons to add or remove roles. These roles may be used for stream, game and event notifications without mentioning everyone.',
        ),
    ],
    components: [row],
  };
}
async function ensureChannel(guild, parent, name, topic, permissionOverwrites) {
  return (
    guild.channels.cache.find(
      (channel) =>
        (channel.name === name ||
          channel.name ===
            {
              'start-here': 'comece-aqui',
              rules: 'regras',
              welcome: 'boas-vindas',
              'choose-roles': 'escolha-cargos',
            }[name]) &&
        channel.type === ChannelType.GuildText,
    ) ??
    guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent,
      topic,
      permissionOverwrites,
      reason: 'Initial Duck Bot setup',
    })
  );
}
async function replaceBotPanels(channel, marker, payload) {
  const recent = await channel.messages.fetch({ limit: 50 });
  const prefix = marker === 'onboarding-rules' ? 'onboarding:accept:' : 'onboarding:role:';
  const old = recent.filter(
    (message) =>
      message.author.id === channel.client.user.id &&
      (message.content === marker ||
        message.components.some((row) =>
          row.components.some((component) => component.customId?.startsWith(prefix)),
        )),
  );
  await Promise.allSettled(old.map((message) => message.delete()));
  await channel.send(payload);
}
async function organizePrivateChannels(guild) {
  const area = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory &&
      channel.name.toLowerCase().replaceAll(' ', '') === 'areadev',
  );
  if (!area) return;
  for (const name of ['log-bot', 'tribunal']) {
    const channel = guild.channels.cache.find(
      (item) => item.name === name && item.type === ChannelType.GuildText,
    );
    if (channel && channel.parentId !== area.id)
      await channel.setParent(area, {
        lockPermissions: false,
        reason: 'Compact Duck Bot layout',
      });
  }
}
async function cleanupLegacyChannels(guild, keepIds) {
  const names = new Set(['rules', 'welcome', 'choose-roles', 'comandos-bot']);
  const targets = guild.channels.cache.filter(
    (channel) => names.has(channel.name) && !keepIds.includes(channel.id),
  );
  const removed = [];
  for (const channel of targets.values()) {
    removed.push(channel.name);
    await channel.delete('Cleanup confirmed in compact setup');
  }
  return removed;
}
