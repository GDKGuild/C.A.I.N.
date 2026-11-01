import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  Client,
  ContextMenuCommandBuilder,
  GuildMember,
  InteractionContextType,
  MessageContextMenuCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { t } from '../i18n';
import { isAdmin, isBotOwner, isServerOwner } from '../permissions';

export function deleteMessageCommandBuilder(): ContextMenuCommandBuilder {
  return new ContextMenuCommandBuilder()
    .setName('delete-message')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]);
}

export async function deleteMessageCommand(client: Client, interaction: MessageContextMenuCommandInteraction): Promise<void> {
  const member = interaction.member as GuildMember | null;
  const allowed =
    isBotOwner(client, interaction.user.id) ||
    isServerOwner(interaction.guild, interaction.user.id) ||
    (member && isAdmin(client, interaction.guild, member));
  if (!allowed) {
    await interaction
      .reply({ content: t('permissions.missing', {}, interaction.locale), flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }

  const message = interaction.targetMessage;
  try {
    await message.delete();
    await interaction
      .reply({ content: 'Message deleted successfully.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
  } catch {
    await interaction
      .reply({ content: 'Message could not be deleted.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}
