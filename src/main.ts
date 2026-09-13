import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { TOKEN } from './config';
import { handleMessageCreate } from './events/messageCreate';
import { registerCommands } from './commands';
import { handleSettingsInteraction } from './views/settings';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('messageCreate', (message) => handleMessageCreate(client, message));
client.on('interactionCreate', (interaction) => {
  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    void handleSettingsInteraction(interaction);
  }
});

void (async () => {
  try {
    await client.login(TOKEN);
    console.log(`Logged in as ${client.user?.tag}`);
    await registerCommands(client);
  } catch (e) {
    console.error('Failed to start bot:', e);
    process.exit(1);
  }
})();