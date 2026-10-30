import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN, CLIENT_ID and GUILD_ID in the .env file.');
}

const rest = new REST().setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
console.log(`🦆 ${commands.length} commands registered in the server.`);
