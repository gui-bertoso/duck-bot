# Duck Bot

Bot moderador para Discord, feito com Node.js e discord.js.

Projeto independente e gratuito sob licença MIT. Cada pessoa executa sua própria
instância no computador ou servidor que escolher, usando seu próprio aplicativo
e token do Discord. Não há assinatura, conta do autor ou backend comercial.

## Recursos

- cria automaticamente o cargo `Bot` e atribui ao próprio Duck Bot;
- cria o canal privado `log-bot` caso ele não exista;
- registra entradas, saídas e ações de moderação;
- comandos `/limpar`, `/expulsar`, `/banir`, `/timeout` e `/untimeout`;
- respostas privadas para evitar poluir os canais do servidor.
- centraliza os comandos no canal `comandos-bot`;
- oferece `/ajuda` e um diagnóstico `/status` para moderadores;
- detecta spam e links de domínios desconhecidos;
- remove a mensagem suspeita e coloca o caso em quarentena;
- permite que o acusado peça julgamento pelo botão recebido na DM;
- fila de tribunal e vereditos pelos comandos `/tribunal-fila` e `/julgar`.
- cadastro persistente de banidos com motivo, moderador e datas de ban/desban;
- consulta em `/banidos` e desbanimento auditado com `/desbanir`.
- dossiê com até 30 mensagens anteriores ao ban, consultável em `/historico-ban`.
- warnings persistentes com pontuação e punição progressiva após reincidências;
- comandos `/avisar`, `/avisos` e `/remover-aviso` para a equipe.
- SQLite com migração automática dos JSON antigos e backup diário;
- automod leve, normal ou rígido, com exceções por canal, cargo e domínio;
- proteção anti-raid, lockdown e verificação de contas novas;
- tribunal privado com provas, votos, timeout, ban e arquivamento em sete dias;
- auditoria de mensagens, cargos, apelidos, canais, entradas e bans externos;
- painel interativo, perfis disciplinares, informações e denúncias sigilosas.
- logger padronizado com horário e nível no terminal, espelhado em embeds no `log-bot`.
- dupla proteção de comandos sensíveis: permissões nativas do Discord e validação interna auditada.
- denúncias de voz com limiar de usuários únicos e revisão urgente pela equipe, sem punição automática;
- cargos de apoiador para Twitch Sub, membro e inscrito do YouTube, concedidos pela equipe;
- histórico recente persistente, com retenção configurável e limpeza automática;
- `/diagnostico` para verificar permissões, canais, banco e hierarquia de cargos;
- métricas de memória, comandos, erros e ações de moderação em `/status`;

## Executar

Requer Node.js 22.5 ou superior.

1. Copie `.env.example` para `.env` e preencha as variáveis.
2. Instale as dependências com `pnpm install`.
3. Registre os comandos com `pnpm deploy`.
4. Inicie com `pnpm start`.
5. Use `pnpm test` para validar persistência, warnings e tribunal.

Crie um canal de texto chamado `comandos-bot`. Quando ele existir, o Duck Bot
aceitará comandos slash somente nele. Os registros continuam no `log-bot`.

O token nunca deve ser enviado ao Git ou compartilhado com outras pessoas.

Os domínios aceitos são configurados em `ALLOWED_DOMAINS`. O filtro não decide se
um site é seguro: todo domínio que não estiver nessa lista será enviado para análise.
O histórico recente é persistido no SQLite para sobreviver a reinícios. Por padrão,
ele é retido por 30 dias e limitado às 30 mensagens mais recentes de cada membro.

## Configuração no Discord

- `controle-bot` (ou `comandos-bot`): central dos comandos e painéis;
- `log-bot`: criado automaticamente e usado para auditoria;
- `tribunal`: criado automaticamente e visível à equipe com permissão de moderação;
- `boas-vindas`: opcional, recebe a mensagem configurada em `/config boas-vindas`.

Use `/config automod`, `/config dominio`, `/config excecao-canal`,
`/config excecao-cargo`, `/config avisos`, `/config retencao` e `/config canal`
para ajustar as regras. `/lockdown` controla a proteção máxima. Warnings expiram
em 30 dias por padrão e três pontos abrem um caso.

O banco fica em `data/duck-bot.db`; cópias diárias ficam em `backups/`. Esses
arquivos contêm dados de moderação e não devem ser publicados.

`BOT_STATUS` controla a presença: `online`, `idle`, `dnd` ou `invisible`.

Eventos operacionais como inicialização, warnings, falhas de conexão, backups e
encerramento são enviados ao `log-bot`. Por segurança, stacks técnicos completos
permanecem somente no terminal local.

## Execução independente e privacidade

Crie seu próprio aplicativo no Discord Developer Portal, adicione o bot ao seu
servidor e habilite os intents de membros e conteúdo de mensagens usados pelo bot.
Preencha apenas o `.env` local com as credenciais desse aplicativo. Não compartilhe
esses valores em issues, capturas de tela ou commits.

Os dados de moderação ficam no SQLite local, com cópias em `backups/`. O bot se
conecta à API do Discord para funcionar e envia registros aos canais configurados
do servidor; não envia dados para um servidor do autor. Revise retenção, permissões
e acesso aos canais de auditoria antes de usar com membros reais.

## Licença

[MIT](LICENSE), para o código do projeto. As dependências mantêm suas próprias licenças.
