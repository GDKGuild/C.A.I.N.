import { ChatInputCommandInteraction, Client, MessageFlags, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from 'discord.js';
import { Filter, Guild as GuildModel } from '../db';
import { t } from '../i18n';

export type ToggleAction = 'enable' | 'disable';
export type ToggleResult = 'enabled' | 'already_enabled' | 'disabled' | 'already_disabled';

export function applyToggle(guild: GuildModel, userId: string, action: ToggleAction): ToggleResult {
  const enabled = Filter.findGetEnabled('members', guild.id, { id: userId, bot: false });
  if (action === 'enable') {
    if (enabled) return 'already_enabled';
    Filter.findOrCreate('members', guild.id, { id: userId, bot: false }).updateEnabled(true, guild);
    return 'enabled';
  }
  if (!enabled) return 'already_disabled';
  Filter.findOrCreate('members', guild.id, { id: userId, bot: false }).updateEnabled(false, guild);
  return 'disabled';
}

export function toggleCommandBuilder(): SlashCommandOptionsOnlyBuilder {
  return new SlashCommandBuilder()
    .setName(t('toggle.command.name'))
    .setDescription(t('toggle.command.description'))
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName(t('toggle.option.action.name'))
        .setDescription(t('toggle.option.action.description'))
        .setRequired(true)
        .addChoices(
          { name: t('toggle.option.action.choice.enable'), value: 'enable' },
          { name: t('toggle.option.action.choice.disable'), value: 'disable' },
        ),
    );
}

export async function toggleCommand(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: t('toggle.errors.guild_only', {}, interaction.locale), flags: MessageFlags.Ephemeral });
    return;
  }
  const action = interaction.options.getString('action', true) as ToggleAction;
  const result = applyToggle(GuildModel.findOrCreate(interaction.guild.id), interaction.user.id, action);
  await interaction.reply({ content: t(`toggle.result.${result}`, {}, interaction.locale), flags: MessageFlags.Ephemeral });
}