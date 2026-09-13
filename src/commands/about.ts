import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
} from 'discord.js';
import { COLOR, EMOJI, LINKS, VERSION } from '../config';
import { t } from '../i18n';
import { setEmbedFooter } from '../utils';

export async function aboutCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const locale = interaction.locale;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(t('about.name', {}, locale))
    .setDescription(t('about.description', {}, locale));

  setEmbedFooter(client, embed);

  const settingsCmd = '/' + t('settings.command.name', {}, locale);

  embed.addFields(
    {
      name: t('about.help.name', {}, locale),
      value: t(
        'about.help.value',
        { settings_command: settingsCmd, support_link: LINKS.support, troubleshooting_section: t('settings.troubleshooting.name', {}, locale) },
        locale,
      ),
      inline: false,
    },
    {
      name: t('about.links.name', {}, locale),
      value: t(
        'about.links.value',
        {
          invite_link: LINKS.invite.replace('{id}', client.user?.id ?? ''),
          repo_link: LINKS.repo,
          translation_link: LINKS.translation,
          credits_link: LINKS.credits,
          support_link: LINKS.support,
        },
        locale,
      ),
      inline: false,
    },
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(t('about.source', {}, locale))
      .setURL(LINKS.repo)
      .setEmoji(EMOJI.github),
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(t('about.invite', {}, locale))
      .setURL(LINKS.invite.replace('{id}', client.user?.id ?? ''))
      .setEmoji(EMOJI.add),
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(t('about.support', {}, locale))
      .setURL(LINKS.support)
      .setEmoji(EMOJI.discord),
  );

  try {
    await interaction.reply({ embeds: [embed], components: [row] });
  } catch (e) {
    if ((e as { code?: number }).code === 10062) return;
    throw e;
  }
}