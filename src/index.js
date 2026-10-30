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
  throw new Error('The DISCORD_TOKEN variable is not configured.');
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
  terminalLog('success', `Duck Bot connected as ${readyClient.user.tag}`);
  terminalLog('info', `Presence configured as ${botStatus}`);

  for (const guild of readyClient.guilds.cache.values()) {
    await configureGuild(guild);
  }
});

client.on(Events.GuildCreate, configureGuild);

client.on(Events.GuildMemberAdd, async (member) => {
  await addVisitorRole(member).catch((error) =>
    terminalLog('warning', `Could not assign Visitor to ${member.user.tag}`, error),
  );
  const { raid, count, settings } = registerJoin(member);
  if (raid && !settings.lockdown) {
    setLockdown(member.guild.id, true);
    await sendLog(
      member.guild,
      '🚨 Raid detected',
      `${count} joins in ${settings.raidWindowSeconds}s. Lockdown enabled automatically.`,
      0xed4245,
    );
  }
  const current = getSettings(member.guild.id);
  if (
    (current.lockdown || accountIsNew(member, current.minimumAccountAgeDays)) &&
    member.moderatable
  ) {
    await member.timeout(60 * 60_000, 'Duck Bot anti-raid verification');
    await sendVerificationDm(member);
  }
  const welcome = member.guild.channels.cache.find((c) => c.name === 'welcome' && c.isTextBased());
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
  await sendLog(member.guild, 'Member joined', `${member.user.tag} joined the server.`, 0x57f287);
});

client.on(Events.GuildMemberRemove, async (member) => {
  audit(member.guild.id, 'member_leave', member.id, {});
  await sendLog(member.guild, 'Member left', `${member.user.tag} left the server.`, 0xed4245);
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
    terminalLog('security', 'Message removed and automatic warning issued', null, {
      servidor: message.guild.name,
      usuario: message.author.tag,
      canal: message.channel.name,
      motivo: violation.reason,
      avisos: `${activeCount}/${threshold}`,
    });
    await sendLog(
      message.guild,
      'Message removed and warning issued',
      `**Member:** ${message.author.tag}\n**Reason:** ${violation.reason}\n**Active warnings:** ${activeCount}/${threshold}`,
      0xfee75c,
      false,
    );

    const action = decideAutomaticAction({ points: activeCount, violation, threshold });
    if (!action.tribunal) return;

    if (action.type === 'ban' && message.member.bannable) {
      await message.member.ban({ reason: `Automatic protection: ${violation.reason}` });
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
        `${activeCount} active points: ${violation.reason}`,
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
      'Case sent to the tribunal',
      `**Accused:** ${message.author.tag}\n**Detection:** ${violation.reason}\n**Score:** ${activeCount}\n**Preventive action:** ${action.label}\n**Case:** ${item.id}`,
      0xed4245,
    );
  } catch (error) {
    await systemLog(message.guild, 'error', 'Automatic filter failed', error);
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
      reason: `Edited message: ${violation.reason}`,
      moderatorId: client.user.id,
      source: 'automatico',
      message: newMessage.content?.slice(0, 1000),
      channelId: newMessage.channel.id,
    });
    await sendWarningDm(newMessage.author, newMessage.guild, result.warning, result.activeCount);
    await sendLog(
      newMessage.guild,
      'Edited message removed and warning issued',
      `**Member:** ${newMessage.author.tag}\n**Reason:** ${violation.reason}\n**Active warnings:** ${result.activeCount}`,
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
      reason: ban.reason ?? 'External/manual ban',
      moderatorId: null,
      source: 'discord',
      messageHistory: getMessageHistory(ban.guild.id, ban.user.id),
    });
    terminalLog('moderation', 'External ban detected', null, {
      servidor: ban.guild.name,
      usuario: ban.user.tag,
      motivo: ban.reason ?? 'Not provided',
    });
    await sendLog(
      ban.guild,
      'Ban detected',
      `**User:** ${ban.user.tag} (${ban.user.id})\n**Reason:** ${ban.reason ?? 'Not provided'}\n**Source:** external/manual action`,
      0xed4245,
      false,
    );
  }
});
client.on(Events.GuildBanRemove, async (ban) => {
  const record = findActiveBan(ban.guild.id, ban.user.id);
  if (record) {
    await registerUnban(ban.guild.id, ban.user.id, null, 'External/manual unban');
    terminalLog('moderation', 'External unban detected', null, {
      servidor: ban.guild.name,
      usuario: ban.user.tag,
    });
    await sendLog(
      ban.guild,
      'Unban detected',
      `**User:** ${ban.user.tag} (${ban.user.id})\n**Source:** external/manual action`,
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
        content: 'Server not found.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      const result = await acceptRules(guild, interaction.user.id);
      const text = result.bypassed
        ? '🛡️ You are an administrator and already have access. Rules confirmed.'
        : '✅ Rules accepted! You received the **Member** role.';
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
      await sendLog(
        guild,
        'New member verified',
        `${result.member.user.tag} accepted the rules${result.bypassed ? ' as an administrator.' : ' and received the Member role.'}`,
        0x57f287,
      );
    } catch (error) {
      await interaction.reply({
        content: `❌ Could not complete: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
      await systemLog(guild, 'error', 'Rule confirmation failed', error);
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('onboarding:role:')) {
    const [, , guildId, slug] = interaction.customId.split(':');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      await interaction.reply({
        content: 'Server not found.',
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
    if (member?.moderatable) await member.timeout(null, 'Verification complete');
    await interaction.update({
      content: '✅ Verification complete. You can now participate in the server.',
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
        content: 'Only moderators can vote.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const [, caseId, verdict] = interaction.customId.split(':');
    const item = getCase(caseId);
    if (!item || item.status !== 'queued') {
      await interaction.reply({
        content: 'This case is not open for voting.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (item.userId === interaction.user.id) {
      await interaction.reply({
        content: 'The accused cannot vote on their own case.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const votes = await voteCase(caseId, interaction.user.id, verdict, 'Vote from dashboard');
    await interaction.reply({
      content: `⚖️ Vote **${{ inocente: 'not guilty', advertencia: 'warning', expulso: 'kicked', banido: 'banned', timeout: 'timeout' }[verdict] ?? verdict}** recorded. Total votes: ${votes.length}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('panel:')) {
    const action = interaction.customId.slice(6);
    const content =
      action === 'help'
        ? 'Use `/help` to see all commands.'
        : action === 'profile'
          ? `Use \`/profile\` to view your warnings and cases.`
          : 'Use `/report` to contact moderators privately.';
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
        content: 'This case is no longer available.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update({
      content: `⚖️ You joined the tribunal queue. Case: **${item.id}**`,
      components: [],
    });
    const guild = client.guilds.cache.get(item.guildId);
    if (guild)
      await sendLog(
        guild,
        'Hearing request',
        `<@${item.userId}> joined the queue. Case: **${item.id}**`,
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
        content: 'This warning is no longer active.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update({
      content: `✅ Warning **${warning.id}** acknowledged. Thank you for cooperating.`,
      embeds: [],
      components: [],
    });
    const guild = client.guilds.cache.get(warning.guildId);
    if (guild)
      await sendLog(
        guild,
        'Warning confirmado',
        `<@${warning.userId}> acknowledged warning **${warning.id}**.`,
        0x57f287,
      );
    return;
  }

  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;

  terminalLog('command', `Command /${interaction.commandName} received`, null, {
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
          ['bot-controls', 'bot-commands', 'controle-bot', 'comandos-bot'].includes(channel.name) &&
          channel.isTextBased(),
      );
    if (commandChannel && interaction.channelId !== commandChannel.id) {
      await interaction.reply({
        content: `🦆 Use my commands in ${commandChannel}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const requiredPermission = commandPermissions.get(interaction.commandName);
    if (requiredPermission && !interaction.member.permissions.has(requiredPermission)) {
      await interaction.reply({
        content: '🔒 You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      await sendLog(
        interaction.guild,
        'Command attempt blocked',
        `**User:** ${interaction.user.tag} (${interaction.user.id})\n**Command:** \`/${interaction.commandName}\`\n**Channel:** ${interaction.channel}`,
        0xed4245,
      );
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = interaction.options.getString('reason') ?? 'Reason not provided';

    if (interaction.commandName === 'config') {
      const sub = interaction.options.getSubcommand();
      const settings = getSettings(interaction.guildId);
      if (sub === 'automod')
        updateSettings(interaction.guildId, {
          automodLevel: interaction.options.getString('level', true),
        });
      else if (sub === 'domain') {
        const domain = interaction.options
          .getString('domain', true)
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .split('/')[0]
          .replace(/^www\./, '');
        if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error('Enter only a valid domain.');
        const domains = new Set(settings.allowedDomains);
        interaction.options.getString('action', true) === 'add'
          ? domains.add(domain)
          : domains.delete(domain);
        updateSettings(interaction.guildId, { allowedDomains: [...domains] });
      } else if (sub === 'channel-exception') {
        const id = interaction.options.getChannel('channel', true).id;
        const ids = new Set(settings.exemptChannelIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        updateSettings(interaction.guildId, { exemptChannelIds: [...ids] });
      } else if (sub === 'role-exception') {
        const id = interaction.options.getRole('cargo', true).id;
        const ids = new Set(settings.exemptRoleIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        updateSettings(interaction.guildId, { exemptRoleIds: [...ids] });
      } else if (sub === 'welcome')
        updateSettings(interaction.guildId, {
          welcomeMessage: interaction.options.getString('message', true),
        });
      else if (sub === 'warnings')
        updateSettings(interaction.guildId, {
          warningThreshold: interaction.options.getInteger('points', true),
        });
      else if (sub === 'retention')
        updateSettings(interaction.guildId, {
          messageRetentionDays: interaction.options.getInteger('days', true),
          messageHistoryEnabled: interaction.options.getBoolean('enabled', true),
        });
      else if (sub === 'channel') {
        const type = interaction.options.getString('type', true);
        const channelId = interaction.options.getChannel('channel', true).id;
        const settingNames = {
          log: 'logChannelId',
          tribunal: 'tribunalChannelId',
          comandos: 'commandChannelId',
        };
        updateSettings(interaction.guildId, { [settingNames[type]]: channelId });
        if (type === 'log') logChannels.set(interaction.guildId, channelId);
      }
      audit(interaction.guildId, 'settings_update', interaction.user.id, { sub });
      await interaction.editReply('✅ Configuration updated.');
      return;
    }
    if (interaction.commandName === 'lockdown') {
      const enabled = interaction.options.getBoolean('enabled', true);
      setLockdown(interaction.guildId, enabled);
      await interaction.editReply(`🔒 Lockdown **${enabled ? 'ativado' : 'desativado'}**.`);
      await sendLog(
        interaction.guild,
        'Lockdown alterado',
        `${interaction.user.tag} ${enabled ? 'enabled' : 'disabled'} anti-raid protection.`,
        enabled ? 0xed4245 : 0x57f287,
      );
      return;
    }
    if (interaction.commandName === 'profile') {
      const user = interaction.options.getUser('member') ?? interaction.user;
      if (
        user.id !== interaction.user.id &&
        !interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)
      )
        throw new Error('You can only view your own profile.');
      const warnings = activeWarnings(interaction.guildId, user.id);
      const cases = queuedCases(interaction.guildId).filter((c) => c.userId === user.id);
      const ban = findLatestBan(interaction.guildId, user.id);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(warnings.length ? 0xfee75c : 0x57f287)
            .setTitle(`Disciplinary profile — ${user.tag}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
              { name: 'Warnings ativos', value: String(warnings.length), inline: true },
              {
                name: 'Tribunal',
                value: cases.length ? 'Case pending' : 'No cases',
                inline: true,
              },
              {
                name: 'Last ban',
                value: ban ? `${ban.status}: ${ban.reason}`.slice(0, 1024) : 'None',
                inline: false,
              },
            ),
        ],
      });
      return;
    }
    if (interaction.commandName === 'userinfo') {
      const user = interaction.options.getUser('member') ?? interaction.user;
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
              `**ID:** \`${user.id}\`\n**Account created:** <t:${created}:R>${joined ? `\n**Entrou:** <t:${joined}:R>` : ''}\n**Roles:** ${member ? member.roles.cache.size - 1 : '—'}`,
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
              { name: 'Members', value: String(guild.memberCount), inline: true },
              { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
              { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
              {
                name: 'Created',
                value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
                inline: true,
              },
            ),
        ],
      });
      return;
    }
    if (interaction.commandName === 'report') {
      const target = interaction.options.getUser('member', true);
      if (target.id === interaction.user.id) throw new Error('You cannot report yourself.');
      if (target.bot) throw new Error('Report bots directly to the moderators.');
      const reportReason = interaction.options.getString('reason', true);
      const type = interaction.options.getString('type') ?? 'texto';
      const evidence = interaction.options.getString('evidence') ?? null;
      const anonymous = interaction.options.getBoolean('anonymous') ?? true;
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      if (
        db
          .prepare(
            'SELECT 1 FROM reports WHERE guild_id=? AND reporter_id=? AND target_id=? AND created_at>=?',
          )
          .get(interaction.guildId, interaction.user.id, target.id, cutoff)
      )
        throw new Error(
          'You already reported this member recently. Wait for moderators to review it.',
        );
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
              .setTitle(`Report ${id} • ${type}`)
              .setDescription(
                `**Target:** ${target}\n**Reporter:** ${anonymous ? 'stored in the private record' : interaction.user}\n**Reason:** ${reportReason}\n**Evidence:** ${evidence ?? 'not attached'}`,
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
            'Urgent voice review required',
            `${target} received ${count} unique voice reports. No automatic punishment was applied; moderators must join the call and review.`,
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
            type: 'serious reports',
            evidence: `${count} unique reports in 30 minutes`,
            messageHistory: getMessageHistory(interaction.guildId, target.id),
          });
          await joinQueue(item.id, target.id);
          await postTribunalPanel(interaction.guild, item, target);
          if (targetMember?.moderatable)
            await targetMember.timeout(60 * 60_000, 'Serious case awaiting tribunal review');
        }
      }
      await interaction.editReply(`✅ Report **${id}** sent privately.`);
      return;
    }
    if (interaction.commandName === 'panel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('panel:help')
          .setLabel('Help')
          .setEmoji('📚')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('panel:profile')
          .setLabel('My profile')
          .setEmoji('👤')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('panel:report')
          .setLabel('Report')
          .setEmoji('🚨')
          .setStyle(ButtonStyle.Danger),
      );
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf4c430)
            .setTitle('🦆 Duck Bot')
            .setDescription('Server security and moderation center. Choose an option below.'),
        ],
        components: [row],
      });
      await interaction.editReply('✅ Dashboard posted.');
      return;
    }
    if (interaction.commandName === 'audit') {
      const user = interaction.options.getUser('member', true);
      const events = userAudit(interaction.guildId, user.id, 20);
      const lines = events.map(
        (e) =>
          `<t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:d> — ${eventLabel(e.event_type)}`,
      );
      await interaction.editReply(
        `**Audit for ${user.tag}:**\n${lines.join('\n') || 'No events recorded.'}`.slice(0, 2000),
      );
      return;
    }
    if (interaction.commandName === 'clear-warnings') {
      const count = clearExpiredWarnings(interaction.guildId);
      await interaction.editReply(`✅ ${count} expired warning(s) archived.`);
      return;
    }
    if (interaction.commandName === 'backup') {
      const path = backupDatabase();
      await interaction.editReply(`✅ Backup created: \`${path}\``);
      return;
    }
    if (interaction.commandName === 'diagnostics') {
      const diagnostic = diagnoseGuild(interaction.guild);
      const formatted = formatDiagnostic(diagnostic);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(diagnostic.failures.length ? 0xfee75c : 0x57f287)
            .setTitle('🩺 Duck Bot diagnostics')
            .setDescription(formatted.summary)
            .addFields(
              { name: 'Permissions', value: formatted.permissions },
              { name: 'Channels', value: formatted.channels },
              {
                name: 'Database',
                value: diagnostic.databaseOk ? '✅ Responding' : '❌ Unavailable',
                inline: true,
              },
              {
                name: 'Hierarchy',
                value: diagnostic.rolePositionOk
                  ? '✅ Bot role is elevated'
                  : '⚠️ Check the Duck Bot role position',
                inline: true,
              },
            )
            .setFooter({ text: 'Place the Duck Bot role above the members it will moderate.' })
            .setTimestamp(),
        ],
      });
      return;
    }
    if (interaction.commandName === 'setup') {
      const format = interaction.options.getString('format') ?? 'compacto';
      const cleanup = interaction.options.getBoolean('clear-old') ?? false;
      const setup = await setupOnboarding(interaction.guild, { format, cleanup });
      const removed = setup.removed.length ? `\n**Removed:** ${setup.removed.join(', ')}` : '';
      await interaction.editReply(
        `✅ **${format}** setup completed in ${setup.category}. Entry: ${setup.rules}.${removed}`,
      );
      await sendLog(
        interaction.guild,
        'Initial setup complete',
        `${interaction.user.tag} created/updated ${format} onboarding.${removed}`,
        0x57f287,
      );
      return;
    }
    if (interaction.commandName === 'voice-moderation') {
      const member = interaction.options.getMember('member');
      if (!member) throw new Error('This member is not in the server.');
      if (!member.voice.channel) throw new Error('This member is not in a voice call.');
      assertModeratable(interaction, member);
      const action = interaction.options.getString('action', true);
      await member.voice.setDeaf(action === 'ensurdecer', reason);
      await interaction.editReply(
        `${action === 'ensurdecer' ? '🔇' : '🔊'} **${member.user.tag}** was ${action === 'ensurdecer' ? 'deafened' : 'undeafened'}.`,
      );
      await moderationLog(interaction, `Voice: ${action}`, member.user.tag, reason);
      return;
    }
    if (interaction.commandName === 'supporter-role') {
      const member = interaction.options.getMember('member');
      if (!member) throw new Error('This member is not in the server.');
      const roleName = interaction.options.getString('platform', true);
      const action = interaction.options.getString('action', true);
      let role = interaction.guild.roles.cache.find((item) => item.name === roleName);
      if (!role)
        role = await interaction.guild.roles.create({
          name: roleName,
          reason: 'Duck Bot supporter role',
        });
      await (action === 'conceder'
        ? member.roles.add(role, 'Support verified by moderators')
        : member.roles.remove(role, 'Support ended or removed'));
      await interaction.editReply(
        `✅ Role **${role.name}** ${action === 'conceder' ? 'granted to' : 'removed from'} **${member.user.tag}**.`,
      );
      await moderationLog(interaction, `Supporter role: ${action}`, member.user.tag, role.name);
      return;
    }

    if (interaction.commandName === 'help') {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf4c430)
            .setTitle('🦆 Central do Duck Bot')
            .setDescription(
              [
                '**Moderation**',
                '`/clear` `/kick` `/ban` `/timeout` `/untimeout`',
                '`/warn` `/warnings` `/remove-warning`',
                '',
                '**Tribunal**',
                '`/tribunal-queue` `/judge`',
                '',
                '**Records**',
                '`/bans` `/unban` `/ban-history`',
                '',
                '**System**',
                '`/help` `/status` `/profile` `/userinfo` `/serverinfo` `/report`',
              ].join('\n'),
            ),
        ],
      });
      return;
    }

    if (interaction.commandName === 'warn') {
      const target = interaction.options.getMember('member');
      if (!target) throw new Error('This member is not in the server.');
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

    if (interaction.commandName === 'warnings') {
      const user = interaction.options.getUser('member', true);
      const warnings = activeWarnings(interaction.guildId, user.id);
      const content = warnings.length
        ? warnings
            .map(
              (warning, index) =>
                `${index + 1}. \`${warning.id}\` — ${warning.reason} — ${warning.severity ?? 1} point(s) — ${warning.acknowledged ? 'acknowledged' : 'not acknowledged'}`,
            )
            .join('\n')
        : 'This member has no active warnings.';
      await interaction.editReply(`**Warnings de ${user.tag}:**\n${content}`);
      return;
    }

    if (interaction.commandName === 'remove-warning') {
      const warningId = interaction.options.getString('warning-id', true);
      const warning = await revokeWarning(
        interaction.guildId,
        warningId,
        interaction.user.id,
        reason,
      );
      if (!warning) throw new Error('No active warning was found with this ID.');
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
                name: 'Connection',
                value: `Online — ${metrics.ping} ms`,
                inline: true,
              },
              { name: 'Uptime', value: formatDuration(metrics.uptime), inline: true },
              { name: 'Memory', value: `${metrics.memoryMb} MB`, inline: true },
              { name: 'Commands processed', value: `${metrics.commands}`, inline: true },
              { name: 'Moderation actions', value: `${metrics.moderationActions}`, inline: true },
              { name: 'Errors recorded', value: `${metrics.errors}`, inline: true },
              {
                name: 'Tribunal',
                value: `${queuedCases(interaction.guildId).length} case(s)`,
                inline: true,
              },
              {
                name: 'Active bans',
                value: `${activeBans(interaction.guildId).length}`,
                inline: true,
              },
              {
                name: 'Commands',
                value: commandChannel ? `${commandChannel}` : 'Channel not created',
                inline: true,
              },
              {
                name: 'Logs',
                value: logChannel?.isTextBased() ? `${logChannel}` : 'Unavailable',
                inline: true,
              },
            )
            .setTimestamp(),
        ],
      });
      return;
    }

    if (interaction.commandName === 'tribunal-queue') {
      const queue = queuedCases(interaction.guildId);
      const content = queue.length
        ? queue
            .slice(0, 20)
            .map(
              (item, index) =>
                `${index + 1}. <@${item.userId}> — ${item.type} — case \`${item.id}\``,
            )
            .join('\n')
        : 'The tribunal queue is empty. Peace reigns on the pond. 🦆';
      await interaction.editReply(content);
      return;
    }

    if (interaction.commandName === 'bans') {
      const bans = activeBans(interaction.guildId);
      const content = bans.length
        ? bans
            .slice(0, 20)
            .map((item, index) => {
              const date = Math.floor(new Date(item.bannedAt).getTime() / 1000);
              return `${index + 1}. **${item.userTag ?? item.userId}** (\`${item.userId}\`)\nReason: ${item.reason} — <t:${date}:d>`;
            })
            .join('\n\n')
        : 'The ban list is empty. 🦆';
      await interaction.editReply(content);
      return;
    }

    if (interaction.commandName === 'unban') {
      const userId = interaction.options.getString('user-id', true).trim();
      if (!/^\d{17,20}$/.test(userId)) throw new Error('Enter a valid user ID.');

      const oldRecord = findActiveBan(interaction.guildId, userId);
      const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
      if (!ban) throw new Error('This user is not banned from this server.');

      await interaction.guild.members.unban(userId, reason);
      const record = await registerUnban(interaction.guildId, userId, interaction.user.id, reason);
      const originalReason = record?.reason ?? oldRecord?.reason ?? ban.reason ?? 'Not recorded';
      await interaction.editReply(
        `✅ **${ban.user.tag}** was unbanned.\nOriginal reason: **${originalReason}**`,
      );
      await sendLog(
        interaction.guild,
        'Member unbanned',
        `**User:** ${ban.user.tag} (${userId})\n**Ban reason:** ${originalReason}\n**Unban reason:** ${reason}\n**Responsible moderator:** ${interaction.user.tag}`,
        0x57f287,
      );
      return;
    }

    if (interaction.commandName === 'ban-history') {
      const userId = interaction.options.getString('user-id', true).trim();
      if (!/^\d{17,20}$/.test(userId)) throw new Error('Enter a valid user ID.');
      const record = findLatestBan(interaction.guildId, userId);
      if (!record) throw new Error('No ban record was found for this user.');

      const history = record.messageHistory ?? [];
      const lines = history.length
        ? history.slice(-15).map((message) => {
            const time = Math.floor(new Date(message.createdAt).getTime() / 1000);
            const content =
              message.content.replace(/\s+/g, ' ').slice(0, 180) || '[no text content]';
            return `<t:${time}:t> <#${message.channelId}> — ${content}`;
          })
        : ['No messages were available when the ban was recorded.'];
      const header = `**Record for ${record.userTag ?? userId}**\n**Ban reason:** ${record.reason}\n`;
      await interaction.editReply(`${header}\n${lines.join('\n')}`.slice(0, 2000));
      return;
    }

    if (interaction.commandName === 'judge') {
      const user = interaction.options.getUser('member', true);
      const verdict = interaction.options.getString('verdict', true);
      const pending = queuedCases(interaction.guildId).find((item) => item.userId === user.id);
      if (!pending) throw new Error('This member has no case awaiting judgment.');

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (verdict === 'banido') {
        if (!member?.bannable)
          throw new Error('I cannot ban this member because of the role hierarchy.');
        await member.ban({ reason: `Tribunal verdict: ${reason}` });
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
          throw new Error('I cannot kick this member because of the role hierarchy.');
        await member.kick(`Tribunal verdict: ${reason}`);
      } else if (verdict === 'timeout' && member?.moderatable) {
        await member.timeout(24 * 60 * 60_000, `Tribunal verdict: ${reason}`);
      } else if (member?.moderatable) {
        await member.timeout(
          null,
          `Tribunal verdict: ${{ inocente: 'not guilty', advertencia: 'warning', expulso: 'kicked', banido: 'banned', timeout: 'timeout' }[verdict] ?? verdict}`,
        );
      }

      await closeCase(interaction.guildId, user.id, verdict, interaction.user.id, reason);
      await interaction.editReply(
        `⚖️ Veredito de **${user.tag}**: **${{ inocente: 'not guilty', advertencia: 'warning', expulso: 'kicked', banido: 'banned', timeout: 'timeout' }[verdict] ?? verdict}**.`,
      );
      await moderationLog(
        interaction,
        `Veredito: ${{ inocente: 'not guilty', advertencia: 'warning', expulso: 'kicked', banido: 'banned', timeout: 'timeout' }[verdict] ?? verdict}`,
        `${user.tag} (${user.id})`,
        reason,
      );
      await user
        .send(
          `⚖️ The tribunal of **${interaction.guild.name}** decided: **${{ inocente: 'not guilty', advertencia: 'warning', expulso: 'kicked', banido: 'banned', timeout: 'timeout' }[verdict] ?? verdict}**. Reason: ${reason}`,
        )
        .catch(() => null);
      return;
    }

    if (interaction.commandName === 'clear') {
      const amount = interaction.options.getInteger('count', true);
      const selectedChannel = interaction.options.getChannel('channel') ?? interaction.channel;
      if (!selectedChannel?.isTextBased() || typeof selectedChannel.bulkDelete !== 'function') {
        throw new Error('Choose a text channel where messages can be deleted.');
      }
      if (
        !selectedChannel
          .permissionsFor(interaction.guild.members.me)
          ?.has(PermissionFlagsBits.ManageMessages)
      ) {
        throw new Error(`I do not have permission to delete messages in ${selectedChannel}.`);
      }
      const deleted = await selectedChannel.bulkDelete(amount, true);
      await interaction.editReply(`${deleted.size} message(s) deleted in ${selectedChannel}.`);
      await moderationLog(
        interaction,
        'Messages deleted',
        `${deleted.size} message(s) in ${selectedChannel}.`,
        reason,
      );
      return;
    }

    const target = interaction.options.getMember('member');
    if (!target) throw new Error('This member is not in the server.');
    assertModeratable(interaction, target);

    if (interaction.commandName === 'kick') {
      if (!target.kickable) throw new Error('I cannot kick this member. Check the role hierarchy.');
      await target.kick(reason);
      await finishAction(interaction, 'Member kicked', target, reason);
    } else if (interaction.commandName === 'ban') {
      if (!target.bannable) throw new Error('I cannot ban this member. Check the role hierarchy.');
      await target.ban({ reason });
      await registerBan({
        guildId: interaction.guildId,
        userId: target.id,
        userTag: target.user.tag,
        reason,
        moderatorId: interaction.user.id,
        source: 'command',
        messageHistory: getMessageHistory(interaction.guildId, target.id),
      });
      await finishAction(interaction, 'Member banned', target, reason);
    } else if (interaction.commandName === 'timeout') {
      if (!target.moderatable) throw new Error('I cannot time out this member.');
      const minutes = interaction.options.getInteger('minutes', true);
      await target.timeout(minutes * 60_000, reason);
      await finishAction(interaction, `Timeout de ${minutes} minuto(s)`, target, reason);
    } else if (interaction.commandName === 'untimeout') {
      if (!target.moderatable) throw new Error("I cannot remove this member's timeout.");
      await target.timeout(null, reason);
      await finishAction(interaction, 'Timeout removido', target, reason);
    }
  } catch (error) {
    await systemLog(
      interaction.guild,
      'error',
      `Command /${interaction.commandName} failed`,
      error,
    );
    const message = `Could not complete: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(message);
    else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
});

async function configureGuild(guild) {
  try {
    const channel = await setupGuild(guild);
    logChannels.set(guild.id, channel.id);
    await systemLog(guild, 'success', 'Duck Bot ready — role and channels checked.');
  } catch (error) {
    terminalLog('error', `Failed to configure ${guild.name}`, error);
  }
}

function assertModeratable(interaction, target) {
  if (target.id === interaction.user.id)
    throw new Error('You cannot perform this action on yourself.');
  if (target.id === interaction.guild.ownerId)
    throw new Error('This action cannot target the server owner.');

  const moderator = interaction.member;
  if (
    moderator.id !== interaction.guild.ownerId &&
    moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    throw new Error("Your role must be above the target member's role.");
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
    `**Target:** ${target}\n**Moderator:** ${interaction.user.tag}\n**Reason:** ${reason}`,
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
  const description = [message, safeError && `**Details:** ${safeError}`]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
  try {
    await sendLog(
      guild,
      `${logIcon(level)} System • ${level.toUpperCase()}`,
      description,
      logColor(level),
      false,
    );
  } catch (logError) {
    terminalLog('error', 'Could not send an event to log-bot', logError);
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
  (error) => void broadcastSystemLog('error', 'Internal Discord client error', error),
);
client.on(
  Events.ShardError,
  (error) => void broadcastSystemLog('error', 'Discord Gateway connection failed', error),
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
      terminalLog('success', `Daily maintenance complete`, null, {
        backup: path,
        mensagensExpiradas: prunedMessages,
      });
    } catch (error) {
      terminalLog('error', 'Automatic backup failed', error);
    }
  },
  24 * 60 * 60_000,
).unref();

async function offerTrial(message, item) {
  const button = new ButtonBuilder()
    .setCustomId(`tribunal:${item.id}`)
    .setLabel('Join the tribunal queue')
    .setEmoji('⚖️')
    .setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(button);
  await message.author
    .send({
      content: `A message you sent in **${message.guild.name}** was flagged as **${item.type}**, and you were quarantined for 10 minutes. To appeal, request a hearing:`,
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
      .setLabel('Not guilty')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:advertencia`)
      .setLabel('Warning')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:timeout`)
      .setLabel('Timeout')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:expulso`)
      .setLabel('Kicked')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`court-vote:${item.id}:banido`)
      .setLabel('Banned')
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
        .setTitle(`⚖️ Case ${item.id}`)
        .setDescription(
          `**Accused:** ${user}\n**Type:** ${item.type}\n**Evidence:** ${item.evidence || '—'}\n\n**Recent history**\n${history || 'No previous messages.'}`,
        )
        .setFooter({ text: 'The accused must request a hearing before voting starts.' })
        .setTimestamp(),
    ],
    components: [row],
  });
}

async function sendVerificationDm(member) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`verify:new-member:${member.guild.id}`)
      .setLabel('Confirm I am human')
      .setEmoji('🦆')
      .setStyle(ButtonStyle.Success),
  );
  await member
    .send({
      content: `Server **${member.guild.name}** is protected against raids. Confirm your membership to remove the restriction:`,
      components: [row],
    })
    .catch(() => null);
}

function eventLabel(type) {
  return (
    {
      warning_created: 'Warning aplicado',
      warning_revoked: 'Warning removido',
      tribunal_created: 'Case opened',
      tribunal_closed: 'Case decided',
      member_banned: 'Ban',
      member_unbanned: 'Unban',
      message_edit: 'Message edited',
      message_delete: 'Message deleted',
      member_roles: 'Roles changed',
      nickname_change: 'Nickname changed',
      report_created: 'Report received',
      member_join: 'Server join',
      member_leave: 'Server departure',
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
            `Your message was removed or a moderator issued a warning.\n\n**Reason:** ${warning.reason}`,
          )
          .addFields(
            { name: 'Aviso', value: warning.id, inline: true },
            { name: 'Warnings ativos', value: `${activeCount}/${threshold}`, inline: true },
          )
          .setFooter({
            text:
              activeCount >= threshold
                ? 'The case was escalated to the tribunal.'
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
