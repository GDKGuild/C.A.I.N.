import { ChatInputCommandInteraction, Client, REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from '../../config.json';
import { t } from '../i18n';
import { TOKEN } from '../config';
import { aboutCommand } from './about';
import { settingsCommand, settingsCommandBuilder } from './settings';
import { listCommand } from './list';

export interface Command {
  builder: SlashCommandBuilder;
  handler: (client: Client, interaction: ChatInputCommandInteraction) => Promise<void>;
}

export function getCommands(): Command[] {
  const commands: Command[] = [];

  if (config.about_command) {
    commands.push({
      builder: new SlashCommandBuilder()
        .setName(t('about.command.name'))
        .setDescription(t('about.command.description'))
        .setDMPermission(false),
      handler: aboutCommand,
    });
  }

  commands.push({
    builder: settingsCommandBuilder(),
    handler: settingsCommand,
  });

  commands.push({
    builder: new SlashCommandBuilder()
      .setName(t('list.command.name'))
      .setDescription(t('list.command.description'))
      .setDMPermission(false),
    handler: listCommand,
  });

  return commands;
}

export async function registerCommands(client: Client): Promise<void> {
  const commands = getCommands();

  client.on('interactionCreate', (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = commands.find((c) => c.builder.name === interaction.commandName);
    if (command) void command.handler(client, interaction);
  });

  if (!client.application?.id) return;
  const rest = new REST().setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.application.id), {
    body: commands.map((c) => c.builder.toJSON()),
  });
}