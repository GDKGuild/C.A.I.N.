import { ChatInputCommandInteraction, Client, MessageFlags, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from 'discord.js';
import { Filter, Guild as GuildModel, User } from '../db';
import { t, resolveLocale } from '../i18n';

export type ToggleAction = 'enable' | 'disable';
export type ToggleResult = 'enabled' | 'already_enabled' | 'disabled' | 'already_disabled';
export type KeepToggleResult = 'keep_on' | 'keep_off';

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

export function applyKeepToggle(guild: GuildModel, userId: string, keep: boolean): KeepToggleResult {
  Filter.findOrCreate('members', guild.id, { id: userId, bot: false }).update({ keep_always: keep });
  return keep ? 'keep_on' : 'keep_off';
}

export function applyToggleDM(user: User, action: ToggleAction): ToggleResult {
  if (action === 'enable') {
    if (user.dm_fixing) return 'already_enabled';
    user.update({ dm_fixing: true });
    return 'enabled';
  }
  if (!user.dm_fixing) return 'already_disabled';
  user.update({ dm_fixing: false });
  return 'disabled';
}

export function toggleCommandBuilder(): SlashCommandOptionsOnlyBuilder {
  return new SlashCommandBuilder()
    .setName(t('toggle.command.name'))
    .setDescription(t('toggle.command.description'))
    .addStringOption((o) =>
      o
        .setName(t('toggle.option.action.name'))
        .setDescription(t('toggle.option.action.description'))
        .addChoices(
          { name: t('toggle.option.action.choice.enable'), value: 'enable' },
          { name: t('toggle.option.action.choice.disable'), value: 'disable' },
        ),
    )
    .addBooleanOption((o) =>
      o.setName(t('toggle.option.keep.name')).setDescription(t('toggle.option.keep.description')),
    );
}

export async function toggleCommand(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const action = interaction.options.getString('action') as ToggleAction | null;
    if (!action) {
      await interaction.reply({ content: t('toggle.errors.no_option', {}, interaction.locale), flags: MessageFlags.Ephemeral });
      return;
    }
    const result = applyToggleDM(User.findOrCreate(interaction.user.id), action);
    await interaction.reply({ content: t(`toggle.result.${result}`, {}, interaction.locale), flags: MessageFlags.Ephemeral });
    return;
  }
  const guild = GuildModel.findOrCreate(interaction.guild.id);
  const locale = resolveLocale(guild, interaction.locale);
  const keep = interaction.options.getBoolean('keep');
  if (keep !== null) {
    const result = applyKeepToggle(guild, interaction.user.id, keep);
    await interaction.reply({ content: t(`toggle.result.${result}`, {}, locale), flags: MessageFlags.Ephemeral });
    return;
  }
  const action = interaction.options.getString('action') as ToggleAction | null;
  if (!action) {
    await interaction.reply({ content: t('toggle.errors.no_option', {}, locale), flags: MessageFlags.Ephemeral });
    return;
  }
  const result = applyToggle(guild, interaction.user.id, action);
  await interaction.reply({ content: t(`toggle.result.${result}`, {}, locale), flags: MessageFlags.Ephemeral });
}
