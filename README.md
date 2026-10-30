# Duck Bot

A Discord moderation bot built with Node.js and discord.js. Free, independent
and available under the MIT License. Run your own instance on a computer or
server you control, using your own Discord application and token. No subscription,
author account or commercial backend is required.

## Features

- Automatic bot-role setup and a private audit-log channel.
- Join, leave and moderation-event logging.
- Message cleanup, kick, ban, timeout and timeout removal commands.
- Private replies and a dedicated command channel.
- Help, operational status, diagnostics and permission checks.
- Spam detection and quarantine for links outside the configured domain allowlist.
- Appeals, a moderation tribunal, evidence, votes and audited verdicts.
- Persistent ban records, warnings, disciplinary profiles and escalating sanctions.
- SQLite storage, migration from older JSON files and daily backups.
- Configurable automod levels, channel/role/domain exceptions and anti-raid lockdown.
- Auditing of messages, roles, nicknames, channels and external bans.
- Configurable message-history retention and automatic cleanup.
- Voice reports reviewed by moderators without automatic punishment.
- Moderator-managed supporter roles for Twitch and YouTube.
- Memory, command, error and moderation metrics.
- Native Discord permission checks plus internal authorization for sensitive actions.

## Run

Requires Node.js 22.5 or later and pnpm.

1. Copy `.env.example` to `.env` and fill in your own application credentials.
2. Install dependencies with `pnpm install`.
3. Register the slash commands with `pnpm deploy`.
4. Start the bot with `pnpm start`.
5. Run `pnpm test` to check persistence, warnings and tribunal behavior.

Create an application in the Discord Developer Portal, add its bot to your server
and enable the member and message-content intents used by the bot. Never commit,
share or include the token in screenshots or issues.

Register the commands again after updating a version that changes command names.
Channel names and settings are described by the setup and configuration commands.
Audit events go to the configured log channel; complete technical stack traces
stay in the local terminal.

## Configuration and privacy

`ALLOWED_DOMAINS` contains comma-separated allowed domains, including subdomains.
The filter does not determine whether a site is safe: unlisted domains are sent
for moderator review. `BOT_STATUS` accepts `online`, `idle`, `dnd` or `invisible`.

Recent message history persists across restarts. The defaults retain it for 30 days
and keep up to 30 recent messages per member. Review permissions, retention and
audit-channel access before using the bot with real members.

The database is `data/duck-bot.db`; daily copies are stored in `backups/`. These
files contain moderation data and must not be published. The bot connects to
Discord's API and sends operational records to the server's configured channels;
it does not send data to an author's server.

## License

[MIT](LICENSE) for the project's code. Dependencies retain their own licenses.
