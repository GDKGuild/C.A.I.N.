import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  Client,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageContextMenuCommandInteraction,
  MessageFlags,
} from 'discord.js';
import { User } from '../db';
import { parse, getEmbeddableUrls } from '../markdown';
import { filterFixableLinks } from '../linkFix';
import { t } from '../i18n';

export function fixLinksCommandBuilder(): ContextMenuCommandBuilder {
  return new ContextMenuCommandBuilder()
    .setName('fix-links')
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);
}

export async function fixLinksCommand(_client: Client, interaction: MessageContextMenuCommandInteraction): Promise<void> {
  const config = User.findOrCreate(interaction.user.id);
  const message = interaction.targetMessage;
  const embeddable = getEmbeddableUrls(parse(message.content ?? ''));
  const links = filterFixableLinks(embeddable, config);

  if (links.length === 0) {
    await interaction
      .reply({ content: t('fixLinks.errors.no_links', {}, interaction.locale), flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }

  await interaction.deferReply();
  const rendered: string[] = [];
  for (const link of links) {
    const out = await link.render();
    if (out) rendered.push(out);
  }
  if (rendered.length === 0) {
    await interaction.editReply({ content: t('fixLinks.errors.failed', {}, interaction.locale) }).catch(() => {});
    return;
  }
  await interaction.editReply({ content: rendered.join('\n') }).catch(() => {});
}
