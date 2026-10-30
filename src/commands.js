import { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits } from 'discord.js';

export const commands = [
  {
    name: 'clear',
    description: 'Delete recent channel messages.',
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [
      {
        name: 'count',
        description: 'Number of messages (1 to 100).',
        type: ApplicationCommandOptionType.Integer,
        required: true,
        minValue: 1,
        maxValue: 100,
      },
      {
        name: 'channel',
        description: 'Channel to clear; defaults to the current channel.',
        type: ApplicationCommandOptionType.Channel,
        required: false,
      },
    ],
  },
  {
    name: 'kick',
    description: 'Kick a member from the server.',
    defaultMemberPermissions: PermissionFlagsBits.KickMembers.toString(),
    options: memberAndReasonOptions(),
  },
  {
    name: 'ban',
    description: 'Ban a member from the server.',
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
    options: memberAndReasonOptions(),
  },
  {
    name: 'timeout',
    description: 'Temporarily time out a member.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'member',
        description: 'Member to time out.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'minutes',
        description: 'Duration between 1 and 40,320 minutes (28 days).',
        type: ApplicationCommandOptionType.Integer,
        required: true,
        minValue: 1,
        maxValue: 40_320,
      },
      reasonOption(),
    ],
  },
  {
    name: 'untimeout',
    description: 'Remove a member timeout.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: memberAndReasonOptions(),
  },
  {
    name: 'tribunal-queue',
    description: 'Show cases awaiting a hearing.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
  },
  {
    name: 'judge',
    description: 'Record a tribunal verdict.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'member',
        description: 'Member to judge.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'verdict',
        description: 'Tribunal verdict.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Not guilty', value: 'inocente' },
          { name: 'Warning', value: 'advertencia' },
          { name: '24-hour timeout', value: 'timeout' },
          { name: 'Kicked', value: 'expulso' },
          { name: 'Banned', value: 'banido' },
        ],
      },
      reasonOption(),
    ],
  },
  {
    name: 'bans',
    description: 'Show the ban list and recorded reasons.',
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
  },
  {
    name: 'unban',
    description: 'Unban a user and archive the ban record.',
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
    options: [
      {
        name: 'user-id',
        description: 'Banned user ID.',
        type: ApplicationCommandOptionType.String,
        required: true,
        minLength: 17,
        maxLength: 20,
      },
      reasonOption(),
    ],
  },
  {
    name: 'ban-history',
    description: 'Show the message history attached to a ban.',
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
    options: [
      {
        name: 'user-id',
        description: 'Banned user ID.',
        type: ApplicationCommandOptionType.String,
        required: true,
        minLength: 17,
        maxLength: 20,
      },
    ],
  },
  {
    name: 'help',
    description: 'Show Duck Bot features and commands.',
  },
  {
    name: 'status',
    description: 'Check Duck Bot health and configuration.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  {
    name: 'warn',
    description: 'Issue a warning to a member.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: memberAndReasonOptions(),
  },
  {
    name: 'warnings',
    description: 'Show active warnings for a member.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'member',
        description: 'Member to look up.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
    ],
  },
  {
    name: 'remove-warning',
    description: 'Remove a warning by its ID.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'warning-id',
        description: 'ID shown by /warnings.',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      reasonOption(),
    ],
  },
  {
    name: 'config',
    description: 'Configure Duck Bot protection.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        name: 'automod',
        description: 'Set the automatic moderation level.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'level',
            description: 'Intensity.',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: 'Light', value: 'leve' },
              { name: 'Normal', value: 'normal' },
              { name: 'Strict', value: 'rigido' },
            ],
          },
        ],
      },
      {
        name: 'domain',
        description: 'Add or remove a trusted domain.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'action',
            description: 'Action.',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: 'Add', value: 'add' },
              { name: 'Remove', value: 'remove' },
            ],
          },
          {
            name: 'domain',
            description: 'Example: example.com',
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: 'channel-exception',
        description: 'Toggle the automod exception for a channel.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'channel',
            description: 'Channel.',
            type: ApplicationCommandOptionType.Channel,
            required: true,
            channelTypes: [ChannelType.GuildText],
          },
        ],
      },
      {
        name: 'role-exception',
        description: 'Toggle the automod exception for a role.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'cargo',
            description: 'Role.',
            type: ApplicationCommandOptionType.Role,
            required: true,
          },
        ],
      },
      {
        name: 'welcome',
        description: 'Set the welcome message.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'message',
            description: 'Use {user} and {server}.',
            type: ApplicationCommandOptionType.String,
            required: true,
            maxLength: 500,
          },
        ],
      },
      {
        name: 'warnings',
        description: 'Set the score required to escalate a case.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'points',
            description: 'Score between 2 and 10.',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 2,
            maxValue: 10,
          },
        ],
      },
      {
        name: 'retention',
        description: 'Configure the history used as evidence.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'days',
            description: 'Retention between 1 and 90 days.',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1,
            maxValue: 90,
          },
          {
            name: 'enabled',
            description: 'Enable or disable history storage.',
            type: ApplicationCommandOptionType.Boolean,
            required: true,
          },
        ],
      },
      {
        name: 'channel',
        description: 'Choose a channel used by Duck Bot.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'type',
            description: 'Channel purpose.',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: 'Logs', value: 'log' },
              { name: 'Tribunal', value: 'tribunal' },
              { name: 'Commands', value: 'comandos' },
            ],
          },
          {
            name: 'channel',
            description: 'Selected text channel.',
            type: ApplicationCommandOptionType.Channel,
            required: true,
            channelTypes: [ChannelType.GuildText],
          },
        ],
      },
    ],
  },
  {
    name: 'lockdown',
    description: 'Enable or disable maximum anti-raid protection.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        name: 'enabled',
        description: 'Lockdown state.',
        type: ApplicationCommandOptionType.Boolean,
        required: true,
      },
    ],
  },
  {
    name: 'profile',
    description: "Show a member's disciplinary status.",
    options: [
      {
        name: 'member',
        description: 'Member; leave empty to view yourself.',
        type: ApplicationCommandOptionType.User,
        required: false,
      },
    ],
  },
  {
    name: 'userinfo',
    description: 'Show information about a member.',
    options: [
      {
        name: 'member',
        description: 'Member to look up.',
        type: ApplicationCommandOptionType.User,
        required: false,
      },
    ],
  },
  { name: 'serverinfo', description: 'Show information about this server.' },
  {
    name: 'report',
    description: 'Send a private report to moderators.',
    options: [
      {
        name: 'member',
        description: 'Member to report.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'reason',
        description: 'Describe what happened.',
        type: ApplicationCommandOptionType.String,
        required: true,
        maxLength: 1000,
      },
      {
        name: 'type',
        description: 'Where or how it happened.',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'Text', value: 'texto' },
          { name: 'Voice chat', value: 'voz' },
          { name: 'Serious case', value: 'grave' },
        ],
      },
      {
        name: 'evidence',
        description: 'Message link or a short evidence description.',
        type: ApplicationCommandOptionType.String,
        required: false,
        maxLength: 500,
      },
      {
        name: 'anonymous',
        description: 'Hide your identity in the moderator dashboard.',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
    ],
  },
  {
    name: 'panel',
    description: 'Post the interactive Duck Bot dashboard.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  {
    name: 'audit',
    description: 'Show a member recent audit events.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'member',
        description: 'Member to look up.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
    ],
  },
  {
    name: 'clear-warnings',
    description: 'Expire warnings past their retention period.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  {
    name: 'backup',
    description: 'Create a local database backup.',
    defaultMemberPermissions: PermissionFlagsBits.Administrator.toString(),
  },
  {
    name: 'diagnostics',
    description: 'Check Duck Bot permissions, channels, database and health.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  {
    name: 'setup',
    description: 'Create compact community onboarding.',
    defaultMemberPermissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      {
        name: 'format',
        description: 'Onboarding layout.',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'Compact — recommended', value: 'compacto' },
          { name: 'Full — multiple channels', value: 'completo' },
        ],
      },
      {
        name: 'clear-old',
        description: 'Delete older channels created by setup.',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
    ],
  },
  {
    name: 'voice-moderation',
    description: 'Ensurdece ou libera um member no chat de voz.',
    defaultMemberPermissions: PermissionFlagsBits.DeafenMembers.toString(),
    options: [
      {
        name: 'member',
        description: 'Membro na call.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'action',
        description: 'Voice action.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Ensurdecer', value: 'ensurdecer' },
          { name: 'Enable audio', value: 'liberar' },
        ],
      },
      reasonOption(),
    ],
  },
  {
    name: 'supporter-role',
    description: 'Grant or remove a manually verified supporter role.',
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles.toString(),
    options: [
      {
        name: 'member',
        description: 'Supporter.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'platform',
        description: 'Benefit verified.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Twitch Sub', value: 'Twitch Sub' },
          { name: 'YouTube Member', value: 'YouTube Member' },
          { name: 'YouTube Subscriber', value: 'YouTube Subscriber' },
        ],
      },
      {
        name: 'action',
        description: 'Grant or remove.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Grant', value: 'conceder' },
          { name: 'Remove', value: 'remove' },
        ],
      },
    ],
  },
];

function memberAndReasonOptions() {
  return [
    {
      name: 'member',
      description: 'Target member.',
      type: ApplicationCommandOptionType.User,
      required: true,
    },
    reasonOption(),
  ];
}

function reasonOption() {
  return {
    name: 'reason',
    description: 'Reason for the action.',
    type: ApplicationCommandOptionType.String,
    required: false,
    maxLength: 500,
  };
}
