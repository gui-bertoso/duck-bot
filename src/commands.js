import {
  ApplicationCommandOptionType,
  PermissionFlagsBits,
} from 'discord.js';

export const commands = [
  {
    name: 'limpar',
    description: 'Apaga mensagens recentes do canal.',
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [{
      name: 'quantidade',
      description: 'Número de mensagens (1 a 100).',
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 100,
    }, {
      name: 'canal',
      description: 'Canal que será limpo; o atual é usado quando omitido.',
      type: ApplicationCommandOptionType.Channel,
      required: false,
    }],
  },
  {
    name: 'expulsar',
    description: 'Expulsa um membro do servidor.',
    defaultMemberPermissions: PermissionFlagsBits.KickMembers.toString(),
    options: memberAndReasonOptions(),
  },
  {
    name: 'banir',
    description: 'Bane um membro do servidor.',
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
    options: memberAndReasonOptions(),
  },
  {
    name: 'timeout',
    description: 'Silencia temporariamente um membro.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'membro',
        description: 'Membro que receberá o timeout.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'minutos',
        description: 'Duração entre 1 e 40.320 minutos (28 dias).',
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
    description: 'Remove o timeout de um membro.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: memberAndReasonOptions(),
  },
  {
    name: 'tribunal-fila',
    description: 'Exibe os casos aguardando julgamento.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
  },
  {
    name: 'julgar',
    description: 'Registra o veredito de um caso do tribunal.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'membro',
        description: 'Membro que será julgado.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'veredito',
        description: 'Decisão do tribunal.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Inocente', value: 'inocente' },
          { name: 'Advertência', value: 'advertencia' },
          { name: 'Banido', value: 'banido' },
        ],
      },
      reasonOption(),
    ],
  },
  {
    name: 'banidos',
    description: 'Consulta a lista de banidos e os motivos registrados.',
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
  },
  {
    name: 'desbanir',
    description: 'Desbane um usuário e arquiva o registro do banimento.',
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
    options: [
      {
        name: 'usuario-id',
        description: 'ID do usuário banido.',
        type: ApplicationCommandOptionType.String,
        required: true,
        minLength: 17,
        maxLength: 20,
      },
      reasonOption(),
    ],
  },
  {
    name: 'historico-ban',
    description: 'Mostra o histórico de mensagens anexado ao banimento.',
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
    options: [{
      name: 'usuario-id',
      description: 'ID do usuário banido.',
      type: ApplicationCommandOptionType.String,
      required: true,
      minLength: 17,
      maxLength: 20,
    }],
  },
  {
    name: 'ajuda',
    description: 'Mostra os recursos e comandos do Duck Bot.',
  },
  {
    name: 'status',
    description: 'Verifica a saúde e a configuração do Duck Bot.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  {
    name: 'avisar',
    description: 'Aplica um warning a um membro.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: memberAndReasonOptions(),
  },
  {
    name: 'avisos',
    description: 'Consulta os warnings ativos de um membro.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [{
      name: 'membro',
      description: 'Membro que será consultado.',
      type: ApplicationCommandOptionType.User,
      required: true,
    }],
  },
  {
    name: 'remover-aviso',
    description: 'Remove um warning pelo identificador.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [{
      name: 'aviso-id',
      description: 'Identificador mostrado em /avisos.',
      type: ApplicationCommandOptionType.String,
      required: true,
    }, reasonOption()],
  },
];

function memberAndReasonOptions() {
  return [
    {
      name: 'membro',
      description: 'Membro alvo da ação.',
      type: ApplicationCommandOptionType.User,
      required: true,
    },
    reasonOption(),
  ];
}

function reasonOption() {
  return {
    name: 'motivo',
    description: 'Motivo da ação.',
    type: ApplicationCommandOptionType.String,
    required: false,
    maxLength: 500,
  };
}
