import { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits } from 'discord.js';

export const commands = [
  {
    name: 'limpar',
    description: 'Apaga mensagens recentes do canal.',
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [
      {
        name: 'quantidade',
        description: 'Número de mensagens (1 a 100).',
        type: ApplicationCommandOptionType.Integer,
        required: true,
        minValue: 1,
        maxValue: 100,
      },
      {
        name: 'canal',
        description: 'Canal que será limpo; o atual é usado quando omitido.',
        type: ApplicationCommandOptionType.Channel,
        required: false,
      },
    ],
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
          { name: 'Timeout de 24 horas', value: 'timeout' },
          { name: 'Expulso', value: 'expulso' },
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
    options: [
      {
        name: 'usuario-id',
        description: 'ID do usuário banido.',
        type: ApplicationCommandOptionType.String,
        required: true,
        minLength: 17,
        maxLength: 20,
      },
    ],
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
    options: [
      {
        name: 'membro',
        description: 'Membro que será consultado.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
    ],
  },
  {
    name: 'remover-aviso',
    description: 'Remove um warning pelo identificador.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'aviso-id',
        description: 'Identificador mostrado em /avisos.',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      reasonOption(),
    ],
  },
  {
    name: 'config',
    description: 'Configura a proteção do Duck Bot.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        name: 'automod',
        description: 'Define o nível da moderação automática.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'nivel',
            description: 'Intensidade.',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: 'Leve', value: 'leve' },
              { name: 'Normal', value: 'normal' },
              { name: 'Rígido', value: 'rigido' },
            ],
          },
        ],
      },
      {
        name: 'dominio',
        description: 'Adiciona ou remove um domínio confiável.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'acao',
            description: 'Ação.',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: 'Adicionar', value: 'adicionar' },
              { name: 'Remover', value: 'remover' },
            ],
          },
          {
            name: 'dominio',
            description: 'Exemplo: exemplo.com',
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: 'excecao-canal',
        description: 'Alterna a exceção de automod para um canal.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'canal',
            description: 'Canal.',
            type: ApplicationCommandOptionType.Channel,
            required: true,
            channelTypes: [ChannelType.GuildText],
          },
        ],
      },
      {
        name: 'excecao-cargo',
        description: 'Alterna a exceção de automod para um cargo.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'cargo',
            description: 'Cargo.',
            type: ApplicationCommandOptionType.Role,
            required: true,
          },
        ],
      },
      {
        name: 'boas-vindas',
        description: 'Define a mensagem de boas-vindas.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'mensagem',
            description: 'Use {user} e {server}.',
            type: ApplicationCommandOptionType.String,
            required: true,
            maxLength: 500,
          },
        ],
      },
      {
        name: 'avisos',
        description: 'Define a pontuação necessária para escalar um caso.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'pontos',
            description: 'Pontuação entre 2 e 10.',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 2,
            maxValue: 10,
          },
        ],
      },
      {
        name: 'retencao',
        description: 'Configura o histórico usado como evidência.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'dias',
            description: 'Retenção entre 1 e 90 dias.',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1,
            maxValue: 90,
          },
          {
            name: 'ativo',
            description: 'Ativa ou desativa o armazenamento do histórico.',
            type: ApplicationCommandOptionType.Boolean,
            required: true,
          },
        ],
      },
      {
        name: 'canal',
        description: 'Escolhe um canal usado pelo Duck Bot.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'tipo',
            description: 'Função do canal.',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: 'Logs', value: 'log' },
              { name: 'Tribunal', value: 'tribunal' },
              { name: 'Comandos', value: 'comandos' },
            ],
          },
          {
            name: 'canal',
            description: 'Canal de texto escolhido.',
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
    description: 'Ativa ou desativa a proteção máxima contra raids.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        name: 'ativo',
        description: 'Estado do lockdown.',
        type: ApplicationCommandOptionType.Boolean,
        required: true,
      },
    ],
  },
  {
    name: 'perfil',
    description: 'Mostra a situação disciplinar de um membro.',
    options: [
      {
        name: 'membro',
        description: 'Membro; deixe vazio para ver você.',
        type: ApplicationCommandOptionType.User,
        required: false,
      },
    ],
  },
  {
    name: 'userinfo',
    description: 'Mostra informações de um membro.',
    options: [
      {
        name: 'membro',
        description: 'Membro consultado.',
        type: ApplicationCommandOptionType.User,
        required: false,
      },
    ],
  },
  { name: 'serverinfo', description: 'Mostra informações deste servidor.' },
  {
    name: 'denunciar',
    description: 'Envia uma denúncia privada à moderação.',
    options: [
      {
        name: 'membro',
        description: 'Membro denunciado.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'motivo',
        description: 'Descreva o ocorrido.',
        type: ApplicationCommandOptionType.String,
        required: true,
        maxLength: 1000,
      },
      {
        name: 'tipo',
        description: 'Onde ou como aconteceu.',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'Texto', value: 'texto' },
          { name: 'Chat de voz', value: 'voz' },
          { name: 'Caso grave', value: 'grave' },
        ],
      },
      {
        name: 'evidencia',
        description: 'Link de uma mensagem ou descrição curta da evidência.',
        type: ApplicationCommandOptionType.String,
        required: false,
        maxLength: 500,
      },
      {
        name: 'anonima',
        description: 'Oculta sua identidade no painel da equipe.',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
    ],
  },
  {
    name: 'painel',
    description: 'Publica o painel interativo do Duck Bot.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  {
    name: 'relatorio',
    description: 'Exibe a auditoria recente de um membro.',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      {
        name: 'membro',
        description: 'Membro consultado.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
    ],
  },
  {
    name: 'limpar-warnings',
    description: 'Expira warnings que passaram do prazo.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  {
    name: 'backup',
    description: 'Cria um backup local do banco de dados.',
    defaultMemberPermissions: PermissionFlagsBits.Administrator.toString(),
  },
  {
    name: 'diagnostico',
    description: 'Verifica permissões, canais, banco e saúde do Duck Bot.',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  {
    name: 'setup-inicial',
    description: 'Cria uma recepção compacta para a comunidade.',
    defaultMemberPermissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      {
        name: 'formato',
        description: 'Organização da recepção.',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'Compacto — recomendado', value: 'compacto' },
          { name: 'Completo — vários canais', value: 'completo' },
        ],
      },
      {
        name: 'limpar-antigo',
        description: 'Apaga os canais antigos criados pelo setup.',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
    ],
  },
  {
    name: 'moderar-voz',
    description: 'Ensurdece ou libera um membro no chat de voz.',
    defaultMemberPermissions: PermissionFlagsBits.DeafenMembers.toString(),
    options: [
      {
        name: 'membro',
        description: 'Membro na call.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'acao',
        description: 'Ação de voz.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Ensurdecer', value: 'ensurdecer' },
          { name: 'Liberar áudio', value: 'liberar' },
        ],
      },
      reasonOption(),
    ],
  },
  {
    name: 'cargo-apoiador',
    description: 'Concede ou remove um cargo de apoiador verificado manualmente.',
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles.toString(),
    options: [
      {
        name: 'membro',
        description: 'Apoiador.',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'plataforma',
        description: 'Benefício verificado.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Twitch Sub', value: 'Twitch Sub' },
          { name: 'Membro YouTube', value: 'Membro YouTube' },
          { name: 'Inscrito YouTube', value: 'Inscrito YouTube' },
        ],
      },
      {
        name: 'acao',
        description: 'Conceder ou remover.',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Conceder', value: 'conceder' },
          { name: 'Remover', value: 'remover' },
        ],
      },
    ],
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
