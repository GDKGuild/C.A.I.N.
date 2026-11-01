import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { TOKEN } from './config';
import { handleMessageCreate } from './events/messageCreate';
import { registerCommands } from './commands';
import { fixLinksCommand } from './commands/fixLinks';
import { deleteMessageCommand } from './commands/deleteMessage';
import { handleSettingsInteraction } from './views/settings';
import { handleListInteraction, isListInteractionId } from './commands/list';
import { handleRevertInteraction, isRevertInteractionId } from './linkFix';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('messageCreate', (message) => handleMessageCreate(client, message));
client.on('interactionCreate', (interaction) => {
  if (interaction.isMessageContextMenuCommand()) {
    if (interaction.commandName === 'fix-links') {
      void fixLinksCommand(client, interaction);
    } else if (interaction.commandName === 'delete-message') {
      void deleteMessageCommand(client, interaction);
    }
  } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    if (isListInteractionId(interaction.customId)) {
      void handleListInteraction(interaction);
    } else if (interaction.isMessageComponent() && isRevertInteractionId(interaction.customId)) {
      void handleRevertInteraction(interaction);
    } else {
      void handleSettingsInteraction(interaction);
    }
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
