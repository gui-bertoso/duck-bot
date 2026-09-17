import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
} from 'discord.js';
import { setupGuild } from './setup-guild.js';
import {
  caseVotes,
  closeCase,
  createCase,
  getCase,
  joinQueue,
  loadTribunal,
  queuedCases,
  voteCase,
} from './tribunal.js';
import {
  activeBans,
  findActiveBan,
  findLatestBan,
  loadBanRegistry,
  registerBan,
  registerUnban,
} from './ban-registry.js';
import {
  acknowledgeWarning,
  activeWarnings,
  addWarning,
  clearExpiredWarnings,
  loadWarnings,
  revokeWarning,
} from './warning-registry.js';
import {
  audit,
  backupDatabase,
  db,
  getSettings,
  migrateJsonOnce,
  updateSettings,
  userAudit,
} from './database.js';
import { inspectMessage } from './automod.js';
import { accountIsNew, registerJoin, setLockdown } from './raid-protection.js';
import { initializeTerminal, logColor, logIcon, terminalLog } from './logger.js';
import { acceptRules, addVisitorRole, setupOnboarding, toggleInterestRole } from './onboarding.js';
import { allowedDomains, botStatus, commandPermissions } from './config.js';
import { getMessageHistory, rememberMessage } from './message-history.js';
import { pruneMessageHistory } from './message-history.js';
import { decideAutomaticAction } from './punishment-policy.js';
import { getMetrics, incrementMetric } from './metrics.js';
import { diagnoseGuild, formatDiagnostic } from './diagnostics.js';

if (!process.env.DISCORD_TOKEN) {
  throw new Error('A variável DISCORD_TOKEN não foi configurada.');
}

initializeTerminal();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  presence: { status: botStatus },
});

const logChannels = new Map();

migrateJsonOnce();
await loadTribunal();
await loadBanRegistry();
await loadWarnings();

client.once(Events.ClientReady, async (readyClient) => {
  readyClient.user.setPresence({ status: botStatus, activities: [] });
  terminalLog('success', `Duck Bot conectado como ${readyClient.user.tag}`);
  terminalLog('info', `Presença configurada como ${botStatus}`);

  for (const guild of readyClient.guilds.cache.values()) {
    await configureGuild(guild);
  }
});

client.on(Events.GuildCreate, configureGuild);

client.on(Events.GuildMemberAdd, async (member) => {
  await addVisitorRole(member).catch((error) =>
    terminalLog('warning', `Não foi possível atribuir Visitante a ${member.user.tag}`, error),
  );
  const { raid, count, settings } = registerJoin(member);
  if (raid && !settings.lockdown) {
    setLockdown(member.guild.id, true);
    await sendLog(
      member.guild,
      '🚨 Raid detectada',
      `${count} entradas em ${settings.raidWindowSeconds}s. Lockdown ativado automaticamente.`,
      0xed4245,
    );
  }
  const current = getSettings(member.guild.id);
  if (
    (current.lockdown || accountIsNew(member, current.minimumAccountAgeDays)) &&
    member.moderatable
  ) {
    await member.timeout(60 * 60_000, 'Verificação anti-raid do Duck Bot');
    await sendVerificationDm(member);
  }
  const welcome = member.guild.channels.cache.find(
    (c) => c.name === 'boas-vindas' && c.isTextBased(),
  );
  if (welcome)
    await welcome
      .send(
        current.welcomeMessage
          .replaceAll('{user}', `${member}`)
          .replaceAll('{server}', member.guild.name),
      )
      .catch(() => null);
  audit(member.guild.id, 'member_join', member.id, {
    accountCreatedAt: member.user.createdAt.toISOString(),
  });
  await sendLog(member.guild, 'Membro entrou', `${member.user.tag} entrou no servidor.`, 0x57f287);
});

client.on(Events.GuildMemberRemove, async (member) => {
  audit(member.guild.id, 'member_leave', member.id, {});
  await sendLog(member.guild, 'Membro saiu', `${member.user.tag} saiu do servidor.`, 0xed4245);
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot || !message.member) return;

  rememberMessage(message);

  const violation = inspectMessage(message, allowedDomains);
  if (!violation) return;

  try {
    if (message.deletable) await message.delete();

    const { warning, activeCount } = await addWarning({
      guildId: message.guild.id,
      userId: message.author.id,
      userTag: message.author.tag,
      reason: violation.reason,
      moderatorId: client.user.id,
      source: 'automatico',
      severity: violation.severity,
      message: message.content.slice(0, 1000),
      channelId: message.channel.id,
    });
    incrementMetric('automaticWarnings');
    await sendWarningDm(message.author, message.guild, warning, activeCount);
    const threshold = getSettings(message.guild.id).warningThreshold;
    terminalLog('security', 'Mensagem removida e warning automático aplicado', null, {
      servidor: message.guild.name,
      usuario: message.author.tag,
      canal: message.channel.name,
      motivo: violation.reason,
      avisos: `${activeCount}/${threshold}`,
    });
    await sendLog(
      message.guild,
      'Mensagem removida e warning aplicado',
      `**Membro:** ${message.author.tag}\n**Motivo:** ${violation.reason}\n**Avisos ativos:** ${activeCount}/${threshold}`,
      0xfee75c,
      false,
    );

    const action = decideAutomaticAction({ points: activeCount, violation, threshold });
    if (!action.tribunal) return;

    if (action.type === 'ban' && message.member.bannable) {
      await message.member.ban({ reason: `Proteção automática: ${violation.reason}` });
      await registerBan({
        guildId: message.guild.id,
        userId: message.author.id,
        userTag: message.author.tag,
        reason: violation.reason,
        moderatorId: client.user.id,
        source: 'automatico',
        messageHistory: getMessageHistory(message.guild.id, message.author.id),
      });
    } else if (action.type === 'timeout' && message.member.moderatable) {
      await message.member.timeout(
        action.minutes * 60_000,
        `${activeCount} pontos ativos: ${violation.reason}`,
      );
    }

    const item = await createCase({
      guildId: message.guild.id,
      userId: message.author.id,
      type: violation.type,
      evidence: message.content.slice(0, 1000),
      messageHistory: getMessageHistory(message.guild.id, message.author.id),
      channelId: message.channel.id,
    });
    await offerTrial(message, item);
    await postTribunalPanel(message.guild, item, message.author);
    await sendLog(
      message.guild,
      'Caso enviado ao tribunal',
      `**Acusado:** ${message.author.tag}\n**Detecção:** ${violation.reason}\n**Pontuação:** ${activeCount}\n**Ação preventiva:** ${action.label}\n**Caso:** ${item.id}`,
      0xed4245,
    );
  } catch (error) {
    await systemLog(message.guild, 'error', 'Falha no filtro automático', error);
  }
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (newMessage.partial) await newMessage.fetch().catch(() => null);
  if (!newMessage.inGuild() || newMessage.author?.bot) return;
  audit(newMessage.guild.id, 'message_edit', newMessage.author?.id, {
    channelId: newMessage.channel.id,
    before: oldMessage.content?.slice(0, 1000),
    after: newMessage.content?.slice(0, 1000),
  });
  const violation = newMessage.member ? inspectMessage(newMessage, allowedDomains) : null;
  if (violation && newMessage.deletable) {
    await newMessage.delete().catch(() => null);
    const result = await addWarning({
      guildId: newMessage.guild.id,
      userId: newMessage.author.id,
      userTag: newMessage.author.tag,
      reason: `Mensagem editada: ${violation.reason}`,
      moderatorId: client.user.id,
      source: 'automatico',
      message: newMessage.content?.slice(0, 1000),
      channelId: newMessage.channel.id,
    });
    await sendWarningDm(newMessage.author, newMessage.guild, result.warning, result.activeCount);
    await sendLog(
      newMessage.guild,
      'Mensagem editada removida e warning aplicado',
      `**Membro:** ${newMessage.author.tag}\n**Motivo:** ${violation.reason}\n**Avisos ativos:** ${result.activeCount}`,
      0xfee75c,
    );
  }
});
client.on(Events.MessageDelete, (message) => {
  if (message.inGuild() && !message.author?.bot)
    audit(message.guild.id, 'message_delete', message.author?.id, {
      channelId: message.channel.id,
      content: message.content?.slice(0, 1000),
    });
});
client.on(Events.GuildMemberUpdate, (before, after) => {
  const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id)).map((r) => r.id);
  const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id)).map((r) => r.id);
  if (added.length || removed.length)
    audit(after.guild.id, 'member_roles', after.id, { added, removed });
  if (before.nickname !== after.nickname)
    audit(after.guild.id, 'nickname_change', after.id, {
      before: before.nickname,
      after: after.nickname,
    });
});
client.on(Events.ChannelCreate, (channel) =>
  audit(channel.guild.id, 'channel_create', null, { channelId: channel.id, name: channel.name }),
);
client.on(Events.ChannelDelete, (channel) =>
  audit(channel.guild.id, 'channel_delete', null, { channelId: channel.id, name: channel.name }),
);
client.on(Events.GuildRoleCreate, (role) =>
  audit(role.guild.id, 'role_create', null, { roleId: role.id, name: role.name }),
);
client.on(Events.GuildRoleDelete, (role) =>
  audit(role.guild.id, 'role_delete', null, { roleId: role.id, name: role.name }),
);
client.on(Events.GuildBanAdd, async (ban) => {
  if (!findActiveBan(ban.guild.id, ban.user.id)) {
    await registerBan({
      guildId: ban.guild.id,
      userId: ban.user.id,
      userTag: ban.user.tag,
      reason: ban.reason ?? 'Banimento externo/manual',
      moderatorId: null,
      source: 'discord',
      messageHistory: getMessageHistory(ban.guild.id, ban.user.id),
    });
    terminalLog('moderation', 'Banimento externo detectado', null, {
      servidor: ban.guild.name,
      usuario: ban.user.tag,
      motivo: ban.reason ?? 'Não informado',
    });
    await sendLog(
      ban.guild,
      'Banimento detectado',
      `**Usuário:** ${ban.user.tag} (${ban.user.id})\n**Motivo:** ${ban.reason ?? 'Não informado'}\n**Origem:** ação externa/manual`,
      0xed4245,
      false,
    );
  }
});
client.on(Events.GuildBanRemove, async (ban) => {
  const record = findActiveBan(ban.guild.id, ban.user.id);
  if (record) {
    await registerUnban(ban.guild.id, ban.user.id, null, 'Desbanimento externo/manual');
    terminalLog('moderation', 'Desbanimento externo detectado', null, {
      servidor: ban.guild.name,
      usuario: ban.user.tag,
    });
    await sendLog(
      ban.guild,
      'Desbanimento detectado',
      `**Usuário:** ${ban.user.tag} (${ban.user.id})\n**Origem:** ação externa/manual`,
      0x57f287,
      false,
    );
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('onboarding:accept:')) {
    const guild = client.guilds.cache.get(interaction.customId.split(':')[2]);
    if (!guild) {
      await interaction.reply({
        content: 'Servidor não encontrado.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      const result = await acceptRules(guild, interaction.user.id);
      const text = result.bypassed
        ? '🛡️ Você faz parte da administração e já possui acesso. As regras foram confirmadas.'
        : '✅ Regras aceitas! Você recebeu o cargo **Membro**.';
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
      await sendLog(
        guild,
        'Novo membro verificado',
        `${result.member.user.tag} aceitou as regras${result.bypassed ? ' como integrante da administração.' : ' e recebeu o cargo Membro.'}`,
        0x57f287,
      );
    } catch (error) {
      await interaction.reply({
        content: `❌ Não consegui concluir: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
      await systemLog(guild, 'error', 'Falha na confirmação das regras', error);
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('onboarding:role:')) {
    const [, , guildId, slug] = interaction.customId.split(':');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      await interaction.reply({
        content: 'Servidor não encontrado.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const result = await toggleInterestRole(guild, interaction.user.id, slug);
    await interaction.reply({
      content: `${result.added ? '✅ Adicionado' : '➖ Removido'}: **${result.role.name}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('verify:new-member:')) {
    const guildId = interaction.customId.split(':')[2] ?? interaction.guildId;
    const guild =
      client.guilds.cache.get(guildId) ??
      client.guilds.cache.find((g) => g.members.cache.has(interaction.user.id));
    const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (member?.moderatable) await member.timeout(null, 'Verificação concluída');
    await interaction.update({
      content: '✅ Verificação concluída. Você já pode participar do servidor.',
      components: [],
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('court-vote:')) {
    if (
      !interaction.inCachedGuild() ||
      !interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      await interaction.reply({
        content: 'Apenas a equipe pode votar.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const [, caseId, verdict] = interaction.customId.split(':');
    const item = getCase(caseId);
    if (!item || item.status !== 'queued') {
      await interaction.reply({
        content: 'Este caso não está aberto para votação.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (item.userId === interaction.user.id) {
      await interaction.reply({
        content: 'O acusado não pode votar no próprio caso.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const votes = await voteCase(caseId, interaction.user.id, verdict, 'Voto pelo painel');
    await interaction.reply({
      content: `⚖️ Voto **${verdict}** registrado. Total de votos: ${votes.length}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('panel:')) {
    const action = interaction.customId.slice(6);
    const content =
      action === 'help'
        ? 'Use `/ajuda` para conhecer todos os comandos.'
        : action === 'profile'
          ? `Use \`/perfil\` para consultar seus warnings e casos.`
          : 'Use `/denunciar` para falar em sigilo com a moderação.';
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('tribunal:')) {
    const item = await joinQueue(
      interaction.customId.slice('tribunal:'.length),
      interaction.user.id,
    );
    if (!item) {
      await interaction.reply({
        content: 'Esse caso não está mais disponível.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update({
      content: `⚖️ Você entrou na fila do tribunal. Caso: **${item.id}**`,
      components: [],
    });
    const guild = client.guilds.cache.get(item.guildId);
    if (guild)
      await sendLog(
        guild,
        'Pedido de julgamento',
        `<@${item.userId}> entrou na fila. Caso: **${item.id}**`,
        0x5865f2,
      );
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('warning:')) {
    const warning = await acknowledgeWarning(
      interaction.customId.slice('warning:'.length),
      interaction.user.id,
    );
    if (!warning) {
      await interaction.reply({
        content: 'Esse aviso não está mais ativo.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update({
      content: `✅ Aviso **${warning.id}** confirmado. Obrigado por colaborar.`,
      embeds: [],
      components: [],
    });
    const guild = client.guilds.cache.get(warning.guildId);
    if (guild)
      await sendLog(
        guild,
        'Warning confirmado',
        `<@${warning.userId}> confirmou o aviso **${warning.id}**.`,
        0x57f287,
      );
    return;
  }

  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;

  terminalLog('command', `Comando /${interaction.commandName} recebido`, null, {
    servidor: interaction.guild.name,
    usuario: interaction.user.tag,
    canal: interaction.channel?.name ?? interaction.channelId,
  });
  incrementMetric('commands');

  try {
    const guildSettings = getSettings(interaction.guildId);
    const commandChannel =
      interaction.guild.channels.cache.get(guildSettings.commandChannelId) ??
      interaction.guild.channels.cache.find(
        (channel) =>
          ['controle-bot', 'comandos-bot'].includes(channel.name) && channel.isTextBased(),
      );
    if (commandChannel && interaction.channelId !== commandChannel.id) {
      await interaction.reply({
        content: `🦆 Use meus comandos em ${commandChannel}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const requiredPermission = commandPermissions.get(interaction.commandName);
    if (requiredPermission && !interaction.member.permissions.has(requiredPermission)) {
      await interaction.reply({
        content: '🔒 Você não possui permissão para usar este comando.',
        flags: MessageFlags.Ephemeral,
      });
      await sendLog(
        interaction.guild,
        'Tentativa de comando bloqueada',
        `**Usuário:** ${interaction.user.tag} (${interaction.user.id})\n**Comando:** \`/${interaction.commandName}\`\n**Canal:** ${interaction.channel}`,
        0xed4245,
      );
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = interaction.options.getString('motivo') ?? 'Motivo não informado';

    if (interaction.commandName === 'config') {
      const sub = interaction.options.getSubcommand();
      const settings = getSettings(interaction.guildId);
      if (sub === 'automod')
        updateSettings(interaction.guildId, {
          automodLevel: interaction.options.getString('nivel', true),
        });
      else if (sub === 'dominio') {
        const domain = interaction.options
          .getString('dominio', true)
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .split('/')[0]
          .replace(/^www\./, '');
        if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error('Informe apenas um domínio válido.');
        const domains = new Set(settings.allowedDomains);
        interaction.options.getString('acao', true) === 'adicionar'
          ? domains.add(domain)
          : domains.delete(domain);
        updateSettings(interaction.guildId, { allowedDomains: [...domains] });
      } else if (sub === 'excecao-canal') {
        const id = interaction.options.getChannel('canal', true).id;
        const ids = new Set(settings.exemptChannelIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        updateSettings(interaction.guildId, { exemptChannelIds: [...ids] });
      } else if (sub === 'excecao-cargo') {
        const id = interaction.options.getRole('cargo', true).id;
        const ids = new Set(settings.exemptRoleIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        updateSettings(interaction.guildId, { exemptRoleIds: [...ids] });
      } else if (sub === 'boas-vindas')
        updateSettings(interaction.guildId, {
          welcomeMessage: interaction.options.getString('mensagem', true),
        });
      else if (sub === 'avisos')
        updateSettings(interaction.guildId, {
          warningThreshold: interaction.options.getInteger('pontos', true),
        });
      else if (sub === 'retencao')
        updateSettings(interaction.guildId, {
          messageRetentionDays: interaction.options.getInteger('dias', true),
          messageHistoryEnabled: interaction.options.getBoolean('ativo', true),
        });
      else if (sub === 'canal') {
        const type = interaction.options.getString('tipo', true);
        const channelId = interaction.options.getChannel('canal', true).id;
        const settingNames = {
          log: 'logChannelId',
          tribunal: 'tribunalChannelId',
          comandos: 'commandChannelId',
        };
        updateSettings(interaction.guildId, { [settingNames[type]]: channelId });
        if (type === 'log') logChannels.set(interaction.guildId, channelId);
      }
      audit(interaction.guildId, 'settings_update', interaction.user.id, { sub });
      await interaction.editReply('✅ Configuração atualizada.');
      return;
    }
    if (interaction.commandName === 'lockdown') {
      const enabled = interaction.options.getBoolean('ativo', true);
      setLockdown(interaction.guildId, enabled);
      await interaction.editReply(`🔒 Lockdown **${enabled ? 'ativado' : 'desativado'}**.`);
      await sendLog(
        interaction.guild,
        'Lockdown alterado',
        `${interaction.user.tag} ${enabled ? 'ativou' : 'desativou'} a proteção anti-raid.`,
        enabled ? 0xed4245 : 0x57f287,
      );
      return;
    }
    if (interaction.commandName === 'perfil') {
      const user = interaction.options.getUser('membro') ?? interaction.user;
      if (
        user.id !== interaction.user.id &&
        !interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)
      )
        throw new Error('Você só pode consultar o próprio perfil.');
      const warnings = activeWarnings(interaction.guildId, user.id);
      const cases = queuedCases(interaction.guildId).filter((c) => c.userId === user.id);
      const ban = findLatestBan(interaction.guildId, user.id);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(warnings.length ? 0xfee75c : 0x57f287)
            .setTitle(`Perfil disciplinar — ${user.tag}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
              { name: 'Warnings ativos', value: String(warnings.length), inline: true },
              {
                name: 'Tribunal',
                value: cases.length ? 'Caso aguardando' : 'Nenhum caso',
                inline: true,
              },
              {
                name: 'Último ban',
                value: ban ? `${ban.status}: ${ban.reason}`.slice(0, 1024) : 'Nenhum',
                inline: false,
              },
            ),
        ],
      });
      return;
    }
    if (interaction.commandName === 'userinfo') {
      const user = interaction.options.getUser('membro') ?? interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const created = Math.floor(user.createdTimestamp / 1000);
      const joined = member ? Math.floor(member.joinedTimestamp / 1000) : null;
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(user.tag)
            .setThumbnail(user.displayAvatarURL())
            .setDescription(
              `**ID:** \`${user.id}\`\n**Conta criada:** <t:${created}:R>${joined ? `\n**Entrou:** <t:${joined}:R>` : ''}\n**Cargos:** ${member ? member.roles.cache.size - 1 : '—'}`,
            ),
        ],
      });
      return;
    }
    if (interaction.commandName === 'serverinfo') {
      const guild = interaction.guild;
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(guild.name)
            .setThumbnail(guild.iconURL())
            .addFields(
              { name: 'Membros', value: String(guild.memberCount), inline: true },
              { name: 'Canais', value: String(guild.channels.cache.size), inline: true },
              { name: 'Cargos', value: String(guild.roles.cache.size), inline: true },
              {
                name: 'Criado',
                value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
                inline: true,
              },
            ),
        ],
      });
      return;
    }
    if (interaction.commandName === 'denunciar') {
      const target = interaction.options.getUser('membro', true);
      if (target.id === interaction.user.id) throw new Error('Você não pode denunciar a si mesmo.');
      if (target.bot) throw new Error('Bots devem ser informados diretamente à equipe.');
      const reportReason = interaction.options.getString('motivo', true);
      const type = interaction.options.getString('tipo') ?? 'texto';
      const evidence = interaction.options.getString('evidencia') ?? null;
      const anonymous = interaction.options.getBoolean('anonima') ?? true;
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      if (
        db
          .prepare(
            'SELECT 1 FROM reports WHERE guild_id=? AND reporter_id=? AND target_id=? AND created_at>=?',
          )
          .get(interaction.guildId, interaction.user.id, target.id, cutoff)
      )
        throw new Error('Você já denunciou esse membro recentemente. Aguarde a equipe analisar.');
      const id = `R-${Date.now().toString(36)}`;
      const storedReason = `[${type}] ${reportReason}`;
      db.prepare(
        `INSERT INTO reports
          (id,guild_id,reporter_id,target_id,reason,status,created_at,data)
         VALUES(?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        interaction.guildId,
        interaction.user.id,
        target.id,
        storedReason,
        'open',
        new Date().toISOString(),
        JSON.stringify({ type, evidence, anonymous }),
      );
      audit(interaction.guildId, 'report_created', target.id, {
        id,
        reporterId: interaction.user.id,
        type,
      });
      const configuredTribunalId = getSettings(interaction.guildId).tribunalChannelId;
      const channel =
        interaction.guild.channels.cache.get(configuredTribunalId) ??
        interaction.guild.channels.cache.find((c) => c.name === 'tribunal' && c.isTextBased());
      if (channel)
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(type === 'grave' ? 0xeb459e : 0xed4245)
              .setTitle(`Denúncia ${id} • ${type}`)
              .setDescription(
                `**Alvo:** ${target}\n**Autor:** ${anonymous ? 'mantido no registro privado' : interaction.user}\n**Motivo:** ${reportReason}\n**Evidência:** ${evidence ?? 'não anexada'}`,
              )
              .setTimestamp(),
          ],
        });
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (type === 'voz') {
        const count = Number(
          db
            .prepare(
              "SELECT COUNT(DISTINCT reporter_id) count FROM reports WHERE guild_id=? AND target_id=? AND substr(reason,1,5)='[voz]' AND created_at>=?",
            )
            .get(interaction.guildId, target.id, cutoff).count,
        );
        if (count >= 3 && targetMember?.voice.channel) {
          await sendLog(
            interaction.guild,
            'Revisão urgente de voz necessária',
            `${target} recebeu ${count} denúncias únicas de voz. Nenhuma punição automática foi aplicada; a equipe deve entrar na call e revisar.`,
            0xeb459e,
          );
        }
      }
      if (type === 'grave') {
        const severeCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
        const count = Number(
          db
            .prepare(
              "SELECT COUNT(DISTINCT reporter_id) count FROM reports WHERE guild_id=? AND target_id=? AND substr(reason,1,7)='[grave]' AND created_at>=?",
            )
            .get(interaction.guildId, target.id, severeCutoff).count,
        );
        if (
          count >= 3 &&
          !queuedCases(interaction.guildId).some((item) => item.userId === target.id)
        ) {
          const item = await createCase({
            guildId: interaction.guildId,
            userId: target.id,
            type: 'denúncias graves',
            evidence: `${count} denúncias únicas em 30 minutos`,
            messageHistory: getMessageHistory(interaction.guildId, target.id),
          });
          await joinQueue(item.id, target.id);
          await postTribunalPanel(interaction.guild, item, target);
          if (targetMember?.moderatable)
            await targetMember.timeout(60 * 60_000, 'Caso grave aguardando tribunal');
        }
      }
      await interaction.editReply(`✅ Denúncia **${id}** enviada em sigilo.`);
      return;
    }
    if (interaction.commandName === 'painel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('panel:help')
          .setLabel('Ajuda')
          .setEmoji('📚')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('panel:profile')
          .setLabel('Meu perfil')
          .setEmoji('👤')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('panel:report')
          .setLabel('Denunciar')
          .setEmoji('🚨')
          .setStyle(ButtonStyle.Danger),
      );
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf4c430)
            .setTitle('🦆 Duck Bot')
            .setDescription(
              'Central de segurança e moderação do servidor. Escolha uma opção abaixo.',
            ),
        ],
        components: [row],
      });
      await interaction.editReply('✅ Painel publicado.');
      return;
    }
    if (interaction.commandName === 'relatorio') {
      const user = interaction.options.getUser('membro', true);
      const events = userAudit(interaction.guildId, user.id, 20);
      const lines = events.map(
        (e) =>
          `<t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:d> — ${eventLabel(e.event_type)}`,
      );
      await interaction.editReply(
        `**Auditoria de ${user.tag}:**\n${lines.join('\n') || 'Nenhum evento registrado.'}`.slice(
          0,
          2000,
        ),
      );
      return;
    }
    if (interaction.commandName === 'limpar-warnings') {
      const count = clearExpiredWarnings(interaction.guildId);
      await interaction.editReply(`✅ ${count} warning(s) expirado(s) foram arquivados.`);
      return;
    }
    if (interaction.commandName === 'backup') {
      const path = backupDatabase();
      await interaction.editReply(`✅ Backup criado: \`${path}\``);
      return;
    }
    if (interaction.commandName === 'diagnostico') {
      const diagnostic = diagnoseGuild(interaction.guild);
      const formatted = formatDiagnostic(diagnostic);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(diagnostic.failures.length ? 0xfee75c : 0x57f287)
            .setTitle('🩺 Diagnóstico do Duck Bot')
            .setDescription(formatted.summary)
            .addFields(
              { name: 'Permissões', value: formatted.permissions },
              { name: 'Canais', value: formatted.channels },
              {
                name: 'Banco de dados',
                value: diagnostic.databaseOk ? '✅ Respondendo' : '❌ Indisponível',
                inline: true,
              },
              {
                name: 'Hierarquia',
                value: diagnostic.rolePositionOk
                  ? '✅ Cargo do bot está elevado'
                  : '⚠️ Confira a posição do cargo Duck Bot',
                inline: true,
              },
            )
            .setFooter({ text: 'Coloque o cargo do Duck Bot acima dos membros que ele moderará.' })
            .setTimestamp(),
        ],
      });
      return;
    }
    if (interaction.commandName === 'setup-inicial') {
      const format = interaction.options.getString('formato') ?? 'compacto';
      const cleanup = interaction.options.getBoolean('limpar-antigo') ?? false;
      const setup = await setupOnboarding(interaction.guild, { format, cleanup });
      const removed = setup.removed.length ? `\n**Removidos:** ${setup.removed.join(', ')}` : '';
      await interaction.editReply(
        `✅ Setup **${format}** concluído em ${setup.category}. Entrada: ${setup.rules}.${removed}`,
      );
      await sendLog(
        interaction.guild,
        'Setup inicial concluído',
        `${interaction.user.tag} criou/atualizou a recepção ${format}.${removed}`,
        0x57f287,
      );
      return;
    }
    if (interaction.commandName === 'moderar-voz') {
      const member = interaction.options.getMember('membro');
      if (!member) throw new Error('Esse membro não está no servidor.');
      if (!member.voice.channel) throw new Error('Esse membro não está em uma call.');
      assertModeratable(interaction, member);
      const action = interaction.options.getString('acao', true);
      await member.voice.setDeaf(action === 'ensurdecer', reason);
      await interaction.editReply(
        `${action === 'ensurdecer' ? '🔇' : '🔊'} **${member.user.tag}** foi ${action === 'ensurdecer' ? 'ensurdecido' : 'liberado'}.`,
      );
      await moderationLog(interaction, `Voz: ${action}`, member.user.tag, reason);
      return;
    }
    if (interaction.commandName === 'cargo-apoiador') {
      const member = interaction.options.getMember('membro');
      if (!member) throw new Error('Esse membro não está no servidor.');
      const roleName = interaction.options.getString('plataforma', true);
      const action = interaction.options.getString('acao', true);
      let role = interaction.guild.roles.cache.find((item) => item.name === roleName);
      if (!role)
        role = await interaction.guild.roles.create({
          name: roleName,
          reason: 'Cargo de apoiador do Duck Bot',
        });
      await (action === 'conceder'
        ? member.roles.add(role, 'Apoio verificado pela equipe')
        : member.roles.remove(role, 'Apoio encerrado ou removido'));
      await interaction.editReply(
        `✅ Cargo **${role.name}** ${action === 'conceder' ? 'concedido a' : 'removido de'} **${member.user.tag}**.`,
      );
      await moderationLog(interaction, `Cargo de apoiador: ${action}`, member.user.tag, role.name);
      return;
    }

    if (interaction.commandName === 'ajuda') {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf4c430)
            .setTitle('🦆 Central do Duck Bot')
            .setDescription(
              [
                '**Moderação**',
                '`/limpar` `/expulsar` `/banir` `/timeout` `/untimeout`',
                '`/avisar` `/avisos` `/remover-aviso`',
                '',
                '**Tribunal**',
                '`/tribunal-fila` `/julgar`',
                '',
                '**Registros**',
                '`/banidos` `/desbanir` `/historico-ban`',
                '',
                '**Sistema**',
                '`/ajuda` `/status` `/perfil` `/userinfo` `/serverinfo` `/denunciar`',
              ].join('\n'),
            ),
        ],
      });
      return;
    }

    if (interaction.commandName === 'avisar') {
      const target = interaction.options.getMember('membro');
      if (!target) throw new Error('Esse membro não está no servidor.');
      assertModeratable(interaction, target);
      const result = await addWarning({
        guildId: interaction.guildId,
        userId: target.id,
        userTag: target.user.tag,
        reason,
        moderatorId: interaction.user.id,
        source: 'manual',
        severity: 1,
      });
      await sendWarningDm(target.user, interaction.guild, result.warning, result.activeCount);
      await interaction.editReply(
        `⚠️ Warning **${result.warning.id}** aplicado a **${target.user.tag}**. Total: ${result.activeCount}.`,
      );
      await moderationLog(
        interaction,
        'Warning aplicado',
        `${target.user.tag} — aviso ${result.warning.id}`,
        reason,
      );
      return;
    }

    if (interaction.commandName === 'avisos') {
      const user = interaction.options.getUser('membro', true);
      const warnings = activeWarnings(interaction.guildId, user.id);
      const content = warnings.length
        ? warnings
            .map(
              (warning, index) =>
                `${index + 1}. \`${warning.id}\` — ${warning.reason} — ${warning.severity ?? 1} ponto(s) — ${warning.acknowledged ? 'confirmado' : 'não confirmado'}`,
            )
            .join('\n')
        : 'Esse membro não possui warnings ativos.';
      await interaction.editReply(`**Warnings de ${user.tag}:**\n${content}`);
      return;
    }

    if (interaction.commandName === 'remover-aviso') {
      const warningId = interaction.options.getString('aviso-id', true);
      const warning = await revokeWarning(
        interaction.guildId,
        warningId,
        interaction.user.id,
        reason,
      );
      if (!warning) throw new Error('Não encontrei um warning ativo com esse identificador.');
      await interaction.editReply(`✅ Warning **${warning.id}** removido de <@${warning.userId}>.`);
      await moderationLog(
        interaction,
        'Warning removido',
        `<@${warning.userId}> — aviso ${warning.id}`,
        reason,
      );
      return;
    }

    if (interaction.commandName === 'status') {
      const logChannel = interaction.guild.channels.cache.get(logChannels.get(interaction.guildId));
      const metrics = getMetrics(client);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(logChannel?.isTextBased() ? 0x57f287 : 0xfee75c)
            .setTitle('Status do Duck Bot')
            .addFields(
              {
                name: 'Conexão',
                value: `Online — ${metrics.ping} ms`,
                inline: true,
              },
              { name: 'Ligado há', value: formatDuration(metrics.uptime), inline: true },
              { name: 'Memória', value: `${metrics.memoryMb} MB`, inline: true },
              { name: 'Comandos processados', value: `${metrics.commands}`, inline: true },
              { name: 'Ações de moderação', value: `${metrics.moderationActions}`, inline: true },
              { name: 'Erros registrados', value: `${metrics.errors}`, inline: true },
              {
                name: 'Tribunal',
                value: `${queuedCases(interaction.guildId).length} caso(s)`,
                inline: true,
              },
              {
                name: 'Banidos ativos',
                value: `${activeBans(interaction.guildId).length}`,
                inline: true,
              },
              {
                name: 'Comandos',
                value: commandChannel ? `${commandChannel}` : 'Canal não criado',
                inline: true,
              },
              {
                name: 'Logs',
                value: logChannel?.isTextBased() ? `${logChannel}` : 'Indisponível',
                inline: true,
              },
            )
            .setTimestamp(),
        ],
      });
      return;
    }

    if (interaction.commandName === 'tribunal-fila') {
      const queue = queuedCases(interaction.guildId);
      const content = queue.length
        ? queue
            .slice(0, 20)
            .map(
              (item, index) =>
                `${index + 1}. <@${item.userId}> — ${item.type} — caso \`${item.id}\``,
            )
            .join('\n')
        : 'A fila do tribunal está vazia. A paz reina no lago. 🦆';
      await interaction.editReply(content);
      return;
    }

    if (interaction.commandName === 'banidos') {
      const bans = activeBans(interaction.guildId);
      const content = bans.length
        ? bans
            .slice(0, 20)
            .map((item, index) => {
              const date = Math.floor(new Date(item.bannedAt).getTime() / 1000);
              return `${index + 1}. **${item.userTag ?? item.userId}** (\`${item.userId}\`)\nMotivo: ${item.reason} — <t:${date}:d>`;
            })
            .join('\n\n')
        : 'A lista de banidos está vazia. 🦆';
      await interaction.editReply(content);
      return;
    }

    if (interaction.commandName === 'desbanir') {
      const userId = interaction.options.getString('usuario-id', true).trim();
      if (!/^\d{17,20}$/.test(userId)) throw new Error('Informe um ID de usuário válido.');

      const oldRecord = findActiveBan(interaction.guildId, userId);
      const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
      if (!ban) throw new Error('Esse usuário não está banido neste servidor.');

      await interaction.guild.members.unban(userId, reason);
      const record = await registerUnban(interaction.guildId, userId, interaction.user.id, reason);
      const originalReason = record?.reason ?? oldRecord?.reason ?? ban.reason ?? 'Não registrado';
      await interaction.editReply(
        `✅ **${ban.user.tag}** foi desbanido.\nMotivo original: **${originalReason}**`,
      );
      await sendLog(
        interaction.guild,
        'Membro desbanido',
        `**Usuário:** ${ban.user.tag} (${userId})\n**Motivo do ban:** ${originalReason}\n**Motivo do desban:** ${reason}\n**Responsável:** ${interaction.user.tag}`,
        0x57f287,
      );
      return;
    }

    if (interaction.commandName === 'historico-ban') {
      const userId = interaction.options.getString('usuario-id', true).trim();
      if (!/^\d{17,20}$/.test(userId)) throw new Error('Informe um ID de usuário válido.');
      const record = findLatestBan(interaction.guildId, userId);
      if (!record) throw new Error('Não encontrei um registro de banimento para esse usuário.');

      const history = record.messageHistory ?? [];
      const lines = history.length
        ? history.slice(-15).map((message) => {
            const time = Math.floor(new Date(message.createdAt).getTime() / 1000);
            const content =
              message.content.replace(/\s+/g, ' ').slice(0, 180) || '[sem conteúdo textual]';
            return `<t:${time}:t> <#${message.channelId}> — ${content}`;
          })
        : ['Nenhuma mensagem estava disponível quando o ban foi registrado.'];
      const header = `**Dossiê de ${record.userTag ?? userId}**\n**Motivo do ban:** ${record.reason}\n`;
      await interaction.editReply(`${header}\n${lines.join('\n')}`.slice(0, 2000));
      return;
    }

    if (interaction.commandName === 'julgar') {
      const user = interaction.options.getUser('membro', true);
      const verdict = interaction.options.getString('veredito', true);
      const pending = queuedCases(interaction.guildId).find((item) => item.userId === user.id);
      if (!pending) throw new Error('Esse membro não possui um caso aguardando julgamento.');

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (verdict === 'banido') {
        if (!member?.bannable)
          throw new Error('Não consigo banir esse membro pela hierarquia de cargos.');
        await member.ban({ reason: `Veredito do tribunal: ${reason}` });
        await registerBan({
          guildId: interaction.guildId,
          userId: user.id,
          userTag: user.tag,
          reason,
          moderatorId: interaction.user.id,
          source: 'tribunal',
          tribunalCaseId: pending.id,
          messageHistory: pending.messageHistory ?? getMessageHistory(interaction.guildId, user.id),
        });
      } else if (verdict === 'expulso') {
        if (!member?.kickable)
          throw new Error('Não consigo expulsar esse membro pela hierarquia de cargos.');
        await member.kick(`Veredito do tribunal: ${reason}`);
      } else if (verdict === 'timeout' && member?.moderatable) {
        await member.timeout(24 * 60 * 60_000, `Veredito do tribunal: ${reason}`);
      } else if (member?.moderatable) {
        await member.timeout(null, `Veredito do tribunal: ${verdict}`);
      }

      await closeCase(interaction.guildId, user.id, verdict, interaction.user.id, reason);
      await interaction.editReply(`⚖️ Veredito de **${user.tag}**: **${verdict}**.`);
      await moderationLog(interaction, `Veredito: ${verdict}`, `${user.tag} (${user.id})`, reason);
      await user
        .send(
          `⚖️ O tribunal de **${interaction.guild.name}** decidiu: **${verdict}**. Motivo: ${reason}`,
        )
        .catch(() => null);
      return;
    }

    if (interaction.commandName === 'limpar') {
      const amount = interaction.options.getInteger('quantidade', true);
      const selectedChannel = interaction.options.getChannel('canal') ?? interaction.channel;
      if (!selectedChannel?.isTextBased() || typeof selectedChannel.bulkDelete !== 'function') {
        throw new Error('Escolha um canal de texto que permita apagar mensagens.');
      }
      if (
        !selectedChannel
          .permissionsFor(interaction.guild.members.me)
          ?.has(PermissionFlagsBits.ManageMessages)
      ) {
        throw new Error(`Não tenho permissão para apagar mensagens em ${selectedChannel}.`);
      }
      const deleted = await selectedChannel.bulkDelete(amount, true);
      await interaction.editReply(`${deleted.size} mensagem(ns) apagada(s) em ${selectedChannel}.`);
      await moderationLog(
        interaction,
        'Mensagens apagadas',
        `${deleted.size} mensagem(ns) em ${selectedChannel}.`,
        reason,
      );
      return;
    }

    const target = interaction.options.getMember('membro');
    if (!target) throw new Error('Esse membro não está no servidor.');
    assertModeratable(interaction, target);

    if (interaction.commandName === 'expulsar') {
      if (!target.kickable)
        throw new Error('Não consigo expulsar esse membro. Verifique a hierarquia de cargos.');
      await target.kick(reason);
      await finishAction(interaction, 'Membro expulso', target, reason);
    } else if (interaction.commandName === 'banir') {
      if (!target.bannable)
        throw new Error('Não consigo banir esse membro. Verifique a hierarquia de cargos.');
      await target.ban({ reason });
      await registerBan({
        guildId: interaction.guildId,
        userId: target.id,
        userTag: target.user.tag,
        reason,
        moderatorId: interaction.user.id,
        source: 'comando',
        messageHistory: getMessageHistory(interaction.guildId, target.id),
      });
      await finishAction(interaction, 'Membro banido', target, reason);
    } else if (interaction.commandName === 'timeout') {
      if (!target.moderatable) throw new Error('Não consigo aplicar timeout nesse membro.');
      const minutes = interaction.options.getInteger('minutos', true);
      await target.timeout(minutes * 60_000, reason);
      await finishAction(interaction, `Timeout de ${minutes} minuto(s)`, target, reason);
    } else if (interaction.commandName === 'untimeout') {
      if (!target.moderatable) throw new Error('Não consigo remover o timeout desse membro.');
      await target.timeout(null, reason);
      await finishAction(interaction, 'Timeout removido', target, reason);
    }
  } catch (error) {
    await systemLog(
      interaction.guild,
      'error',
      `Falha no comando /${interaction.commandName}`,
      error,
    );
    const message = `Não foi possível concluir: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(message);
    else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
});

async function configureGuild(guild) {
  try {
    const channel = await setupGuild(guild);
    logChannels.set(guild.id, channel.id);
    await systemLog(guild, 'success', 'Duck Bot pronto — cargo e canais verificados.');
  } catch (error) {
    terminalLog('error', `Falha ao configurar ${guild.name}`, error);
  }
}

function assertModeratable(interaction, target) {
  if (target.id === interaction.user.id)
    throw new Error('Você não pode executar essa ação em si mesmo.');
  if (target.id === interaction.guild.ownerId)
    throw new Error('O dono do servidor não pode receber essa ação.');

  const moderator = interaction.member;
  if (
    moderator.id !== interaction.guild.ownerId &&
    moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    throw new Error('Seu cargo precisa estar acima do cargo do membro alvo.');
  }
}

async function finishAction(interaction, action, target, reason) {
  await interaction.editReply(`${action}: **${target.user.tag}**.`);
  await moderationLog(interaction, action, `${target.user.tag} (${target.id})`, reason);
}

async function moderationLog(interaction, title, target, reason) {
  incrementMetric('moderationActions');
  terminalLog('moderation', title, null, {
    servidor: interaction.guild.name,
    alvo: target,
    moderador: interaction.user.tag,
    motivo: reason,
  });

  await sendLog(
    interaction.guild,
    title,
    `**Alvo:** ${target}\n**Moderador:** ${interaction.user.tag}\n**Motivo:** ${reason}`,
    0xfee75c,
    false,
  );
}

async function sendLog(guild, title, description, color, mirrorToTerminal = true) {
  if (mirrorToTerminal) {
    terminalLog('info', title, null, { servidor: guild.name });
  }

  let channel = guild.channels.cache.get(logChannels.get(guild.id));
  if (!channel?.isTextBased()) {
    channel = await setupGuild(guild);
    logChannels.set(guild.id, channel.id);
  }

  await channel.send({
    embeds: [
      new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp(),
    ],
  });
}

async function systemLog(guild, level, message, error) {
  if (level === 'error') incrementMetric('errors');
  terminalLog(level, message, error);
  if (!guild) return;
  const safeError = error instanceof Error ? error.message : String(error ?? '');
  const description = [message, safeError && `**Detalhe:** ${safeError}`]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
  try {
    await sendLog(
      guild,
      `${logIcon(level)} Sistema • ${level.toUpperCase()}`,
      description,
      logColor(level),
      false,
    );
  } catch (logError) {
    terminalLog('error', 'Não foi possível enviar um evento ao log-bot', logError);
  }
}

async function broadcastSystemLog(level, message, error) {
  await Promise.allSettled(
    client.guilds.cache.map((guild) => systemLog(guild, level, message, error)),
  );
}

const seenWarnings = new Set();
process.on('warning', (warning) => {
  const key = `${warning.name}:${warning.message}`;
  if (seenWarnings.has(key)) return;
  seenWarnings.add(key);
  void broadcastSystemLog('warning', `${warning.name}: ${warning.message}`);
});
client.on(
  Events.Error,
  (error) => void broadcastSystemLog('error', 'Erro interno do cliente Discord', error),
);
client.on(
  Events.ShardError,
  (error) => void broadcastSystemLog('error', 'Falha na conexão com o Gateway do Discord', error),
);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  await broadcastSystemLog('warning', `Duck Bot encerrando por ${signal}.`);
  client.destroy();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

client.login(process.env.DISCORD_TOKEN);
setInterval(
  () => {
    try {
      let prunedMessages = 0;
      for (const guild of client.guilds.cache.values()) {
        prunedMessages += pruneMessageHistory(guild.id);
      }
      const path = backupDatabase();
      terminalLog('success', `Manutenção diária concluída`, null, {
        backup: path,
        mensagensExpiradas: prunedMessages,
      });
    } catch (error) {
      terminalLog('error', 'Falha no backup automático', error);
    }
  },
  24 * 60 * 60_000,
).unref();

async function offerTrial(message, item) {
  const button = new ButtonBuilder()
    .setCustomId(`tribunal:${item.id}`)
    .setLabel('Entrar na fila do tribunal')
    .setEmoji('⚖️')
    .setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(button);
  await message.author
    .send({
      content: `Uma mensagem sua em **${message.guild.name}** foi sinalizada por **${item.type}** e você recebeu 10 minutos de quarentena. Se quiser contestar, peça um julgamento:`,
      components: [row],
    })
    .catch(() => null);
}

async function postTribunalPanel(guild, item, user) {
  const configuredChannelId = getSettings(guild.id).tribunalChannelId;
  const channel =
    guild.channels.cache.get(configuredChannelId) ??
    guild.channels.cache.find((c) => c.name === 'tribunal' && c.isTextBased());
  if (!channel) return;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:inocente`)
      .setLabel('Inocente')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:advertencia`)
      .setLabel('Advertência')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:timeout`)
      .setLabel('Timeout')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:expulso`)
      .setLabel('Expulso')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:banido`)
      .setLabel('Banido')
      .setStyle(ButtonStyle.Danger),
  );
  const history = (item.messageHistory ?? [])
    .slice(-5)
    .map(
      (m) =>
        `<#${m.channelId}>: ${(m.content || '[sem texto]').replace(/\s+/g, ' ').slice(0, 150)}`,
    )
    .join('\n');
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`⚖️ Caso ${item.id}`)
        .setDescription(
          `**Acusado:** ${user}\n**Tipo:** ${item.type}\n**Prova:** ${item.evidence || '—'}\n\n**Histórico recente**\n${history || 'Sem mensagens anteriores.'}`,
        )
        .setFooter({ text: 'O acusado precisa pedir julgamento antes da votação.' })
        .setTimestamp(),
    ],
    components: [row],
  });
}

async function sendVerificationDm(member) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`verify:new-member:${member.guild.id}`)
      .setLabel('Confirmar que sou humano')
      .setEmoji('🦆')
      .setStyle(ButtonStyle.Success),
  );
  await member
    .send({
      content: `O servidor **${member.guild.name}** está protegido contra raids. Confirme sua entrada para remover a restrição:`,
      components: [row],
    })
    .catch(() => null);
}

function eventLabel(type) {
  return (
    {
      warning_created: 'Warning aplicado',
      warning_revoked: 'Warning removido',
      tribunal_created: 'Caso aberto',
      tribunal_closed: 'Caso julgado',
      member_banned: 'Banimento',
      member_unbanned: 'Desbanimento',
      message_edit: 'Mensagem editada',
      message_delete: 'Mensagem apagada',
      member_roles: 'Cargos alterados',
      nickname_change: 'Apelido alterado',
      report_created: 'Denúncia recebida',
      member_join: 'Entrada no servidor',
      member_leave: 'Saída do servidor',
    }[type] ?? type
  );
}

async function sendWarningDm(user, guild, warning, activeCount) {
  const threshold = getSettings(guild.id).warningThreshold;
  const button = new ButtonBuilder()
    .setCustomId(`warning:${warning.id}`)
    .setLabel('Entendi o aviso')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success);
  const row = new ActionRowBuilder().addComponents(button);
  await user
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle(`⚠️ Aviso em ${guild.name}`)
          .setDescription(
            `Sua mensagem foi removida ou a equipe emitiu um aviso.\n\n**Motivo:** ${warning.reason}`,
          )
          .addFields(
            { name: 'Aviso', value: warning.id, inline: true },
            { name: 'Warnings ativos', value: `${activeCount}/${threshold}`, inline: true },
          )
          .setFooter({
            text:
              activeCount >= threshold
                ? 'O caso foi escalado para o tribunal.'
                : `${threshold} warnings ativos escalam o caso.`,
          })
          .setTimestamp(),
      ],
      components: [row],
    })
    .catch(() => null);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}min`].filter(Boolean).join(' ');
}
