import {
  ApplicationIntegrationType,
  ChatInputCommandInteraction,
  Client,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import config from '../../config.json';
import { t } from '../i18n';
import { TOKEN } from '../config';
import { isBotOwner } from '../permissions';
import { aboutCommand } from './about';
import { settingsCommand, settingsCommandBuilder } from './settings';
import { listCommand } from './list';
import { toggleCommand, toggleCommandBuilder } from './toggle';
import { eventCommand, eventCommandBuilder } from './event';
import { fixLinksCommandBuilder } from './fixLinks';
import { MysteryExclusion } from '../db';

export interface Command {
  builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | ContextMenuCommandBuilder;
  handler: (client: Client, interaction: ChatInputCommandInteraction) => Promise<void>;
}

function installable(builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder): SlashCommandBuilder | SlashCommandOptionsOnlyBuilder {
  return builder
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);
}

export function getCommands(): Command[] {
  const commands: Command[] = [];

  if (config.about_command) {
    commands.push({
      builder: installable(
        new SlashCommandBuilder()
          .setName(t('about.command.name'))
          .setDescription(t('about.command.description')),
      ),
      handler: aboutCommand,
    });
  }

  commands.push({
    builder: installable(settingsCommandBuilder()),
    handler: settingsCommand,
  });

  commands.push({
    builder: installable(
      new SlashCommandBuilder()
        .setName(t('list.command.name'))
        .setDescription(t('list.command.description')),
    ),
    handler: listCommand,
  });

  commands.push({
    builder: installable(toggleCommandBuilder()),
    handler: toggleCommand,
  });

  const eventName = config.event_command.name;
  if (config.event_command.enabled && !commands.some((c) => c.builder.name === eventName)) {
    commands.push({
      builder: eventCommandBuilder(),
      handler: eventCommand,
    });
  }

  commands.push({
    builder: new SlashCommandBuilder()
      .setName('exclude')
      .setDescription('Toggle mystery fixer exclusion')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
    handler: async (client: Client, interaction: ChatInputCommandInteraction) => {
      if (!isBotOwner(client, interaction.user.id)) {
        await interaction.reply({ content: 'Not allowed.', flags: MessageFlags.Ephemeral });
        return;
      }
      const user = interaction.options.getUser('user', true);
      const excluded = MysteryExclusion.toggle(user.username);
      await interaction.reply({ content: `${user.username} ${excluded ? 'excluded' : 'included'}.`, flags: MessageFlags.Ephemeral });
    },
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
  const body = [...commands.map((c) => c.builder.toJSON()), fixLinksCommandBuilder().toJSON()];
  await rest.put(Routes.applicationCommands(client.application.id), { body });
}
