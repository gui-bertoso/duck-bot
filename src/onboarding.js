import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';

const roleDefinitions = [
  { name: 'Visitante', color: 0x99aab5 },
  { name: 'Membro', color: 0x57f287 },
  { name: 'Lives', color: 0x9146ff, emoji: '📺', slug: 'lives' },
  { name: 'Jogos', color: 0x5865f2, emoji: '🎮', slug: 'jogos' },
  { name: 'Eventos', color: 0xfee75c, emoji: '🎉', slug: 'eventos' },
  { name: 'Twitch Sub', color: 0x9146ff },
  { name: 'Membro YouTube', color: 0xff0000 },
  { name: 'Inscrito YouTube', color: 0xff6666 },
];

export async function setupOnboarding(guild, { format = 'compacto', cleanup = false } = {}) {
  const roles = {};
  for (const definition of roleDefinitions) {
    roles[definition.name] =
      guild.roles.cache.find((role) => role.name === definition.name) ??
      (await guild.roles.create({
        name: definition.name,
        color: definition.color,
        reason: 'Setup inicial do Duck Bot',
      }));
  }
  const category =
    guild.channels.cache.find(
      (channel) => channel.name === 'COMECE AQUI' && channel.type === ChannelType.GuildCategory,
    ) ??
    (await guild.channels.create({
      name: 'COMECE AQUI',
      type: ChannelType.GuildCategory,
      position: 0,
      reason: 'Setup inicial do Duck Bot',
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
      'comece-aqui',
      'Regras, verificação e escolha de interesses.',
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
      'regras',
      'Leia e aceite as regras para liberar seu acesso.',
      readOnly,
    );
    welcome = await ensureChannel(
      guild,
      category,
      'boas-vindas',
      'Novos membros da comunidade.',
      readOnly,
    );
    rolesChannel = await ensureChannel(
      guild,
      category,
      'escolha-cargos',
      'Escolha os assuntos que deseja acompanhar.',
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
  const role = member.guild.roles.cache.find((item) => item.name === 'Visitante');
  if (role && member.manageable && !member.roles.cache.has(role.id))
    await member.roles.add(role, 'Novo membro aguardando regras');
}

export async function acceptRules(guild, userId) {
  const member = await guild.members.fetch(userId);
  const visitor = guild.roles.cache.find((role) => role.name === 'Visitante');
  const memberRole = guild.roles.cache.find((role) => role.name === 'Membro');
  if (!memberRole) throw new Error('O cargo Membro não existe. Execute /setup-inicial.');
  if (member.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageGuild))
    return { member, bypassed: true };
  if (!member.manageable) throw new Error('Meu cargo precisa ficar acima dos cargos deste membro.');
  if (!member.roles.cache.has(memberRole.id)) await member.roles.add(memberRole, 'Regras aceitas');
  if (visitor && member.roles.cache.has(visitor.id))
    await member.roles.remove(visitor, 'Regras aceitas');
  return { member, bypassed: false };
}

export async function toggleInterestRole(guild, userId, slug) {
  const definition = roleDefinitions.find((item) => item.slug === slug);
  if (!definition) throw new Error('Cargo de interesse inválido.');
  const member = await guild.members.fetch(userId);
  const role = guild.roles.cache.find((item) => item.name === definition.name);
  if (!role) throw new Error('Cargo não encontrado. Execute /setup-inicial.');
  const removing = member.roles.cache.has(role.id);
  await (removing
    ? member.roles.remove(role, 'Escolha de interesses')
    : member.roles.add(role, 'Escolha de interesses'));
  return { role, added: !removing };
}

function rulesPanel(guild) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`onboarding:accept:${guild.id}`)
      .setLabel('Li e aceito as regras')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xf4c430)
        .setTitle(`🦆 Bem-vindo à ${guild.name}`)
        .setDescription(
          [
            'Para conviver bem com a comunidade:',
            '',
            '1. Respeite todos os membros.',
            '2. Não faça spam nem divulgue golpes.',
            '3. Use cada canal para o assunto indicado.',
            '4. Conteúdo ofensivo ou ilegal não é permitido.',
            '5. Siga as orientações da moderação.',
            '',
            'Clique abaixo para confirmar e receber o cargo **Membro**.',
          ].join('\n'),
        )
        .setFooter({ text: 'Ao confirmar, você concorda com as regras do servidor.' }),
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
        .setTitle('Escolha seus interesses')
        .setDescription(
          'Use os botões para adicionar ou remover cargos. Eles poderão ser usados para avisar sobre lives, jogos e eventos sem mencionar todo mundo.',
        ),
    ],
    components: [row],
  };
}
async function ensureChannel(guild, parent, name, topic, permissionOverwrites) {
  return (
    guild.channels.cache.find(
      (channel) => channel.name === name && channel.type === ChannelType.GuildText,
    ) ??
    guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent,
      topic,
      permissionOverwrites,
      reason: 'Setup inicial do Duck Bot',
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
        reason: 'Organização compacta do Duck Bot',
      });
  }
}
async function cleanupLegacyChannels(guild, keepIds) {
  const names = new Set(['regras', 'boas-vindas', 'escolha-cargos', 'comandos-bot']);
  const targets = guild.channels.cache.filter(
    (channel) => names.has(channel.name) && !keepIds.includes(channel.id),
  );
  const removed = [];
  for (const channel of targets.values()) {
    removed.push(channel.name);
    await channel.delete('Limpeza confirmada no setup compacto');
  }
  return removed;
}
