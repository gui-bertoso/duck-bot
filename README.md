# Duck Bot

Bot moderador para Discord, feito com Node.js e discord.js.

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
- warnings persistentes com confirmação por botão e escalada após reincidências;
- comandos `/avisar`, `/avisos` e `/remover-aviso` para a equipe.
- SQLite com migração automática dos JSON antigos e backup diário;
- automod leve, normal ou rígido, com exceções por canal, cargo e domínio;
- proteção anti-raid, lockdown e verificação de contas novas;
- tribunal privado com provas, votos, timeout, ban e arquivamento em sete dias;
- auditoria de mensagens, cargos, apelidos, canais, entradas e bans externos;
- painel interativo, perfis disciplinares, informações e denúncias sigilosas.

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
O histórico começa quando o bot é ligado e só é gravado permanentemente quando um
caso é aberto ou alguém é banido.

## Configuração no Discord

- `comandos-bot`: central dos comandos e painéis;
- `log-bot`: criado automaticamente e usado para auditoria;
- `tribunal`: criado automaticamente e visível à equipe com permissão de moderação;
- `boas-vindas`: opcional, recebe a mensagem configurada em `/config boas-vindas`.

Use `/config automod`, `/config dominio`, `/config excecao-canal` e
`/config excecao-cargo` para ajustar as regras. `/lockdown` controla a proteção
máxima. Warnings expiram em 30 dias por padrão e três pontos abrem um caso.

O banco fica em `data/duck-bot.db`; cópias diárias ficam em `backups/`. Esses
arquivos contêm dados de moderação e não devem ser publicados.
