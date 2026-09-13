import { ChatInputCommandInteraction, Client, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { t } from '../i18n';
import { SettingsView } from '../views/settings';

export function settingsCommandBuilder(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(t('settings.command.name'))
    .setDescription(t('settings.command.description'))
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
}

export async function settingsCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  await new SettingsView(interaction).send(interaction);
}