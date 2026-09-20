import { ChatInputCommandInteraction, Client, GuildMember, SlashCommandBuilder } from 'discord.js';
import { t } from '../i18n';
import { canUseSettings, denySettings } from '../permissions';
import { SettingsView } from '../views/settings';

export function settingsCommandBuilder(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(t('settings.command.name'))
    .setDescription(t('settings.command.description'))
    .setDMPermission(false);
}

export async function settingsCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!interaction.guild || !member || !canUseSettings(client, interaction.guild, member)) {
    await denySettings(interaction);
    return;
  }
  await new SettingsView(interaction).send(interaction);
}