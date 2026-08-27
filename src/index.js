import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from 'discord.js';
import { setupGuild } from './setup-guild.js';
import { closeCase, createCase, joinQueue, loadTribunal, queuedCases } from './tribunal.js';
import { activeBans, findActiveBan, findLatestBan, loadBanRegistry, registerBan, registerUnban } from './ban-registry.js';
import { acknowledgeWarning, activeWarnings, addWarning, loadWarnings, revokeWarning } from './warning-registry.js';

if (!process.env.DISCORD_TOKEN) {
  throw new Error('A variável DISCORD_TOKEN não foi configurada.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const logChannels = new Map();
const recentMessages = new Map();
const messageHistory = new Map();
const allowedDomains = (process.env.ALLOWED_DOMAINS ?? '')
  .split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean);

await loadTribunal();
await loadBanRegistry();
await loadWarnings();

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`🦆 Duck Bot conectado como ${readyClient.user.tag}`);

  for (const guild of readyClient.guilds.cache.values()) {
    await configureGuild(guild);
  }
});

client.on(Events.GuildCreate, configureGuild);

client.on(Events.GuildMemberAdd, async (member) => {
  await sendLog(member.guild, 'Membro entrou', `${member.user.tag} entrou no servidor.`, 0x57f287);
});

client.on(Events.GuildMemberRemove, async (member) => {
  await sendLog(member.guild, 'Membro saiu', `${member.user.tag} saiu do servidor.`, 0xed4245);
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot || !message.member) return;

  rememberMessage(message);

  const violation = detectViolation(message);
  if (!violation) return;

  try {
    if (message.deletable) await message.delete();

    const { warning, activeCount } = await addWarning({
      guildId: message.guild.id,
      userId: message.author.id,
      userTag: message.author.tag,
      reason: violation,
      moderatorId: client.user.id,
      source: 'automatico',
      message: message.content.slice(0, 1000),
      channelId: message.channel.id,
    });
    await sendWarningDm(message.author, message.guild, warning, activeCount);
    await sendLog(message.guild, 'Mensagem removida e warning aplicado', `**Membro:** ${message.author.tag}\n**Motivo:** ${violation}\n**Avisos ativos:** ${activeCount}/3`, 0xfee75c);

    if (activeCount < 3) return;
    if (message.member.moderatable) await message.member.timeout(10 * 60_000, `3 warnings ativos: ${violation}`);

    const item = await createCase({
      guildId: message.guild.id,
      userId: message.author.id,
      type: violation,
      evidence: message.content.slice(0, 1000),
      messageHistory: getMessageHistory(message.guild.id, message.author.id),
      channelId: message.channel.id,
    });
    await offerTrial(message, item);
    await sendLog(message.guild, 'Caso enviado ao tribunal', `**Acusado:** ${message.author.tag}\n**Detecção:** ${violation}\n**Caso:** ${item.id}`, 0xed4245);
  } catch (error) {
    console.error('Falha no filtro automático:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('tribunal:')) {
    const item = await joinQueue(interaction.customId.slice('tribunal:'.length), interaction.user.id);
    if (!item) {
      await interaction.reply({ content: 'Esse caso não está mais disponível.', ephemeral: true });
      return;
    }
    await interaction.update({ content: `⚖️ Você entrou na fila do tribunal. Caso: **${item.id}**`, components: [] });
    const guild = client.guilds.cache.get(item.guildId);
    if (guild) await sendLog(guild, 'Pedido de julgamento', `<@${item.userId}> entrou na fila. Caso: **${item.id}**`, 0x5865f2);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('warning:')) {
    const warning = await acknowledgeWarning(interaction.customId.slice('warning:'.length), interaction.user.id);
    if (!warning) {
      await interaction.reply({ content: 'Esse aviso não está mais ativo.', ephemeral: true });
      return;
    }
    await interaction.update({ content: `✅ Aviso **${warning.id}** confirmado. Obrigado por colaborar.`, embeds: [], components: [] });
    const guild = client.guilds.cache.get(warning.guildId);
    if (guild) await sendLog(guild, 'Warning confirmado', `<@${warning.userId}> confirmou o aviso **${warning.id}**.`, 0x57f287);
    return;
  }

  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;

  try {
    const commandChannel = interaction.guild.channels.cache.find(
      (channel) => channel.name === 'comandos-bot' && channel.isTextBased(),
    );
    if (commandChannel && interaction.channelId !== commandChannel.id) {
      await interaction.reply({ content: `🦆 Use meus comandos em ${commandChannel}.`, ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const reason = interaction.options.getString('motivo') ?? 'Motivo não informado';

    if (interaction.commandName === 'ajuda') {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xf4c430)
          .setTitle('🦆 Central do Duck Bot')
          .setDescription([
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
            '`/ajuda` `/status`',
          ].join('\n'))],
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
      });
      await sendWarningDm(target.user, interaction.guild, result.warning, result.activeCount);
      await interaction.editReply(`⚠️ Warning **${result.warning.id}** aplicado a **${target.user.tag}**. Total: ${result.activeCount}.`);
      await moderationLog(interaction, 'Warning aplicado', `${target.user.tag} — aviso ${result.warning.id}`, reason);
      return;
    }

    if (interaction.commandName === 'avisos') {
      const user = interaction.options.getUser('membro', true);
      const warnings = activeWarnings(interaction.guildId, user.id);
      const content = warnings.length
        ? warnings.map((warning, index) => `${index + 1}. \`${warning.id}\` — ${warning.reason} — ${warning.acknowledged ? 'confirmado' : 'não confirmado'}`).join('\n')
        : 'Esse membro não possui warnings ativos.';
      await interaction.editReply(`**Warnings de ${user.tag}:**\n${content}`);
      return;
    }

    if (interaction.commandName === 'remover-aviso') {
      const warningId = interaction.options.getString('aviso-id', true);
      const warning = await revokeWarning(interaction.guildId, warningId, interaction.user.id, reason);
      if (!warning) throw new Error('Não encontrei um warning ativo com esse identificador.');
      await interaction.editReply(`✅ Warning **${warning.id}** removido de <@${warning.userId}>.`);
      await moderationLog(interaction, 'Warning removido', `<@${warning.userId}> — aviso ${warning.id}`, reason);
      return;
    }

    if (interaction.commandName === 'status') {
      const logChannel = interaction.guild.channels.cache.get(logChannels.get(interaction.guildId));
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(logChannel?.isTextBased() ? 0x57f287 : 0xfee75c)
          .setTitle('Status do Duck Bot')
          .addFields(
            { name: 'Conexão', value: `Online — ${Math.max(0, Math.round(client.ws.ping))} ms`, inline: true },
            { name: 'Ligado há', value: formatDuration(client.uptime ?? 0), inline: true },
            { name: 'Tribunal', value: `${queuedCases(interaction.guildId).length} caso(s)`, inline: true },
            { name: 'Banidos ativos', value: `${activeBans(interaction.guildId).length}`, inline: true },
            { name: 'Comandos', value: commandChannel ? `${commandChannel}` : 'Canal não criado', inline: true },
            { name: 'Logs', value: logChannel?.isTextBased() ? `${logChannel}` : 'Indisponível', inline: true },
          )
          .setTimestamp()],
      });
      return;
    }


    if (interaction.commandName === 'tribunal-fila') {
      const queue = queuedCases(interaction.guildId);
      const content = queue.length
        ? queue.slice(0, 20).map((item, index) => `${index + 1}. <@${item.userId}> — ${item.type} — caso \`${item.id}\``).join('\n')
        : 'A fila do tribunal está vazia. A paz reina no lago. 🦆';
      await interaction.editReply(content);
      return;
    }

    if (interaction.commandName === 'banidos') {
      const bans = activeBans(interaction.guildId);
      const content = bans.length
        ? bans.slice(0, 20).map((item, index) => {
          const date = Math.floor(new Date(item.bannedAt).getTime() / 1000);
          return `${index + 1}. **${item.userTag ?? item.userId}** (\`${item.userId}\`)\nMotivo: ${item.reason} — <t:${date}:d>`;
        }).join('\n\n')
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
      await interaction.editReply(`✅ **${ban.user.tag}** foi desbanido.\nMotivo original: **${originalReason}**`);
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
          const content = message.content.replace(/\s+/g, ' ').slice(0, 180) || '[sem conteúdo textual]';
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
        if (!member?.bannable) throw new Error('Não consigo banir esse membro pela hierarquia de cargos.');
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
      } else if (member?.moderatable) {
        await member.timeout(null, `Veredito do tribunal: ${verdict}`);
      }

      await closeCase(interaction.guildId, user.id, verdict, interaction.user.id, reason);
      await interaction.editReply(`⚖️ Veredito de **${user.tag}**: **${verdict}**.`);
      await moderationLog(interaction, `Veredito: ${verdict}`, `${user.tag} (${user.id})`, reason);
      await user.send(`⚖️ O tribunal de **${interaction.guild.name}** decidiu: **${verdict}**. Motivo: ${reason}`).catch(() => null);
      return;
    }

    if (interaction.commandName === 'limpar') {
      const amount = interaction.options.getInteger('quantidade', true);
      const selectedChannel = interaction.options.getChannel('canal') ?? interaction.channel;
      if (!selectedChannel?.isTextBased() || typeof selectedChannel.bulkDelete !== 'function') {
        throw new Error('Escolha um canal de texto que permita apagar mensagens.');
      }
      if (!selectedChannel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
        throw new Error(`Não tenho permissão para apagar mensagens em ${selectedChannel}.`);
      }
      const deleted = await selectedChannel.bulkDelete(amount, true);
      await interaction.editReply(`${deleted.size} mensagem(ns) apagada(s) em ${selectedChannel}.`);
      await moderationLog(interaction, 'Mensagens apagadas', `${deleted.size} mensagem(ns) em ${selectedChannel}.`, reason);
      return;
    }

    const target = interaction.options.getMember('membro');
    if (!target) throw new Error('Esse membro não está no servidor.');
    assertModeratable(interaction, target);

    if (interaction.commandName === 'expulsar') {
      if (!target.kickable) throw new Error('Não consigo expulsar esse membro. Verifique a hierarquia de cargos.');
      await target.kick(reason);
      await finishAction(interaction, 'Membro expulso', target, reason);
    } else if (interaction.commandName === 'banir') {
      if (!target.bannable) throw new Error('Não consigo banir esse membro. Verifique a hierarquia de cargos.');
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
    console.error(error);
    const message = `Não foi possível concluir: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(message);
    else await interaction.reply({ content: message, ephemeral: true });
  }
});

async function configureGuild(guild) {
  try {
    const channel = await setupGuild(guild);
    logChannels.set(guild.id, channel.id);
    await sendLog(guild, 'Duck Bot pronto', 'Cargo e canal de logs verificados.', 0xf4c430);
  } catch (error) {
    console.error(`Falha ao configurar ${guild.name}:`, error);
  }
}

function assertModeratable(interaction, target) {
  if (target.id === interaction.user.id) throw new Error('Você não pode executar essa ação em si mesmo.');
  if (target.id === interaction.guild.ownerId) throw new Error('O dono do servidor não pode receber essa ação.');

  const moderator = interaction.member;
  if (
    moderator.id !== interaction.guild.ownerId
    && moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    throw new Error('Seu cargo precisa estar acima do cargo do membro alvo.');
  }
}

async function finishAction(interaction, action, target, reason) {
  await interaction.editReply(`${action}: **${target.user.tag}**.`);
  await moderationLog(interaction, action, `${target.user.tag} (${target.id})`, reason);
}

async function moderationLog(interaction, title, target, reason) {
  await sendLog(
    interaction.guild,
    title,
    `**Alvo:** ${target}\n**Moderador:** ${interaction.user.tag}\n**Motivo:** ${reason}`,
    0xfee75c,
  );
}

async function sendLog(guild, title, description, color) {
  let channel = guild.channels.cache.get(logChannels.get(guild.id));
  if (!channel?.isTextBased()) {
    channel = await setupGuild(guild);
    logChannels.set(guild.id, channel.id);
  }

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp()],
  });
}

client.login(process.env.DISCORD_TOKEN);

function detectViolation(message) {
  const now = Date.now();
  const key = `${message.guild.id}:${message.author.id}`;
  const history = (recentMessages.get(key) ?? []).filter((entry) => now - entry.time < 8_000);
  history.push({ time: now, content: message.content });
  recentMessages.set(key, history);

  if (history.length >= 6) return 'spam: muitas mensagens em poucos segundos';
  const repeats = history.filter((entry) => entry.content === message.content).length;
  if (message.content.length >= 4 && repeats >= 3) return 'spam: mensagem repetida';

  const urls = message.content.match(/https?:\/\/[^\s<]+/gi) ?? [];
  for (const rawUrl of urls) {
    try {
      const hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
      const trusted = allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
      if (!trusted) return `link de domínio desconhecido: ${hostname}`;
    } catch {
      return 'link inválido ou suspeito';
    }
  }
  return null;
}

function rememberMessage(message) {
  const key = `${message.guild.id}:${message.author.id}`;
  const history = messageHistory.get(key) ?? [];
  history.push({
    messageId: message.id,
    channelId: message.channel.id,
    content: message.content.slice(0, 1000),
    createdAt: message.createdAt.toISOString(),
  });
  if (history.length > 30) history.splice(0, history.length - 30);
  messageHistory.set(key, history);
}

function getMessageHistory(guildId, userId) {
  return [...(messageHistory.get(`${guildId}:${userId}`) ?? [])];
}

async function offerTrial(message, item) {
  const button = new ButtonBuilder()
    .setCustomId(`tribunal:${item.id}`)
    .setLabel('Entrar na fila do tribunal')
    .setEmoji('⚖️')
    .setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(button);
  await message.author.send({
    content: `Uma mensagem sua em **${message.guild.name}** foi sinalizada por **${item.type}** e você recebeu 10 minutos de quarentena. Se quiser contestar, peça um julgamento:`,
    components: [row],
  }).catch(() => null);
}

async function sendWarningDm(user, guild, warning, activeCount) {
  const button = new ButtonBuilder()
    .setCustomId(`warning:${warning.id}`)
    .setLabel('Entendi o aviso')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success);
  const row = new ActionRowBuilder().addComponents(button);
  await user.send({
    embeds: [new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(`⚠️ Aviso em ${guild.name}`)
      .setDescription(`Sua mensagem foi removida ou a equipe emitiu um aviso.\n\n**Motivo:** ${warning.reason}`)
      .addFields(
        { name: 'Aviso', value: warning.id, inline: true },
        { name: 'Warnings ativos', value: `${activeCount}/3`, inline: true },
      )
      .setFooter({ text: activeCount >= 3 ? 'O caso foi escalado para o tribunal.' : 'Três warnings ativos escalam o caso.' })
      .setTimestamp()],
    components: [row],
  }).catch(() => null);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}min`].filter(Boolean).join(' ');
}
