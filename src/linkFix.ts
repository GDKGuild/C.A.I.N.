import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Embed,
  Message,
  MessageComponentInteraction,
  MessageFlags,
  NewsChannel,
  PartialMessage,
  PermissionFlagsBits,
  PermissionsBitField,
  TextChannel,
  ThreadChannel,
  Webhook,
  WebhookMessageCreateOptions,
} from 'discord.js';
import { Filter, Guild, User, type WebsiteConfig } from './db';
import { type EmbeddableUrl } from './markdown';
import { websites, type WebsiteLink } from './websites';
import { groupItems, safeSend } from './utils';
import { t, resolveLocale } from './i18n';
import { KEEP_IGNORE_THRESHOLD, KEEP_PROMPT_THRESHOLD } from './config';

export type GuildChannel = TextChannel | NewsChannel | ThreadChannel;

export function getWebsite(config: WebsiteConfig, url: string, spoiler = false): WebsiteLink | null {
  for (const website of websites) {
    const link = website.ifValid(config, url, spoiler);
    if (link) return link;
  }
  return null;
}

export function filterFixableLinks(links: EmbeddableUrl[], config: WebsiteConfig): WebsiteLink[] {
  const out: WebsiteLink[] = [];
  for (const { url, spoiler } of links) {
    const link = getWebsite(config, url, spoiler);
    if (link) out.push(link);
  }
  return out;
}

export async function fixEmbeds(originalMessage: Message, config: WebsiteConfig, links: WebsiteLink[], client: Client): Promise<void> {
  const channel = originalMessage.channel as GuildChannel;
  const me = originalMessage.guild?.members.me ?? null;
  let permissions: PermissionsBitField;
  if (me === null) {
    permissions = new PermissionsBitField();
  } else {
    const channelPerms = channel.isTextBased() ? channel.permissionsFor(me) : null;
    if (
      channelPerms === null ||
      (channel.isThread() && (channel.locked || channel.archived)) ||
      !(channelPerms.has(PermissionFlagsBits.SendMessages) && channelPerms.has(PermissionFlagsBits.EmbedLinks))
    ) {
      return;
    }
    permissions = channelPerms;
  }

  if (!config.reply_as_original_author_replica) {
    await safeSend(channel.sendTyping(), { forbidden: true });
  }

  const rendered: WebsiteLink[] = [];
  for (const link of links) {
    if (await link.render()) rendered.push(link);
  }
  let [notSent, messages] =
    rendered.length > 0 ? await sendFixedLinks(rendered, config, originalMessage, client) : [[], []];

  const allSent: Array<[Message, WebsiteLink[]]> = [];
  let toDelete: Message[] = [];
  if (messages.length > 0) {
    let pending: Array<[Message, WebsiteLink[]]> = messages;
    while (pending.length > 0) {
      const results = await Promise.all(pending.map(([msg]) => waitForEmbed(msg, client)));
      const nextPending: Array<[Message, WebsiteLink[]]> = [];
      for (let i = 0; i < pending.length; i++) {
        const [msg, linksInGroup] = pending[i];
        if (results[i]) {
          allSent.push([msg, linksInGroup]);
          continue;
        }
        const retried: WebsiteLink[] = [];
        for (const link of linksInGroup) {
          if (await link.retryNextFixer()) retried.push(link);
        }
        if (retried.length > 0) {
          const [notSent2, messages2] = await sendFixedLinks(retried, config, originalMessage, client);
          notSent.push(...notSent2);
          nextPending.push(...messages2);
        }
        toDelete.push(msg);
      }
      pending = nextPending;
    }
    if (toDelete.length > 0) {
      console.warn(`message(s) has no embed after waiting: ${toDelete.length}`);
      await Promise.all(toDelete.map((m) => safeSend(m.delete(), { notFound: true, forbidden: true })));
    }
  }
  if (notSent.length > 0) {
    console.warn(`message(s) failed to send: ${notSent.length}`);
  }
  if (messages.length > 0 && toDelete.length === 0 && notSent.length === 0) {
    await editOriginalMessage(config, originalMessage, permissions, client);
  }
  // ponytail: prompt skipped when webhook-attributed but the webhook is unavailable (no ManageWebhooks)
  const webhook = config.reply_as_original_author_replica ? await getOrCreateWebhook(channel, client) : null;
  const usedMystery = allSent.some(([, groupLinks]) => groupLinks.some((l) => l.usedMysteryFixer));
  if (!usedMystery && allSent.length > 0 && (!config.reply_as_original_author_replica || webhook !== null)) {
    const locale = originalMessage.guildId ? resolveLocale(Guild.find(originalMessage.guildId)) : resolveLocale(null);
    await registerRevertPrompt(originalMessage, allSent, webhook, locale);
  }
}

export async function sendFixedLinks(
  renderedLinks: WebsiteLink[],
  config: WebsiteConfig,
  originalMessage: Message,
  client: Client,
): Promise<[Array<[string, WebsiteLink[]]>, Array<[Message, WebsiteLink[]]>]> {
  const channel = originalMessage.channel as GuildChannel;
  const messagesSent: Array<[Message, WebsiteLink[]]> = [];
  const linksFailed: Array<[string, WebsiteLink[]]> = [];

  const grouped = groupItems(renderedLinks, 2000, '\n', (link) => link.rendered ?? '');
  const webhook = config.reply_as_original_author_replica ? await getOrCreateWebhook(channel, client) : null;

  for (let i = 0; i < grouped.length; i++) {
    const [messageContent, linksInGroup] = grouped[i];
    let coro: Promise<Message>;
    if (webhook) {
      coro = webhookSend(webhook, originalMessage, messageContent, config.reply_silently);
    } else if (i === 0 && config.reply_to_message) {
      coro = originalMessage.reply({
        content: messageContent,
        flags: config.reply_silently ? [MessageFlags.SuppressNotifications] : undefined,
        allowedMentions: { repliedUser: false },
      });
    } else {
      coro = channel.send({
        content: messageContent,
        flags: config.reply_silently ? [MessageFlags.SuppressNotifications] : undefined,
      });
    }
    const [sent, msg] = await safeSend(coro, {
      invalidFormBody: 'Embed size exceeds maximum size',
      forbidden: true,
    });
    if (sent && msg) {
      messagesSent.push([msg, linksInGroup]);
    } else {
      linksFailed.push([messageContent, linksInGroup]);
    }
  }

  return [linksFailed, messagesSent];
}

export async function getOrCreateWebhook(channel: GuildChannel, client: Client): Promise<Webhook | null> {
  const webhookChannel = (channel.isThread() ? channel.parent : channel) as TextChannel | NewsChannel | null;
  if (webhookChannel === null) return null;
  if (!('fetchWebhooks' in webhookChannel) || !('createWebhook' in webhookChannel)) return null;

  const me = webhookChannel.guild.members.me;
  const permissions = me ? webhookChannel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ManageWebhooks)) return null;

  const [ok, webhooks] = await safeSend(webhookChannel.fetchWebhooks(), { forbidden: true });
  if (!ok || !webhooks) return null;

  const botId = client.user?.id;
  const existing = webhooks.find((w) => w.owner?.id === botId);
  if (existing) return existing;

  const [ok2, created] = await safeSend(
    webhookChannel.createWebhook({ name: client.user?.displayName ?? 'C.A.I.N.' }),
    { forbidden: true },
  );
  return ok2 && created ? created : null;
}

export async function webhookSend(webhook: Webhook, originalMessage: Message, content: string, silent: boolean): Promise<Message> {
  const options: WebhookMessageCreateOptions = {
    content,
    username: originalMessage.member?.displayName ?? originalMessage.author.displayName,
    avatarURL: originalMessage.member?.displayAvatarURL() ?? originalMessage.author.displayAvatarURL(),
    flags: silent ? [MessageFlags.SuppressNotifications] : undefined,
  };
  if (originalMessage.channel.isThread()) {
    options.threadId = originalMessage.channel.id;
  }
  return webhook.send(options);
}

export async function waitForEmbed(message: Message, client: Client): Promise<boolean> {
  if (message.embeds.length > 0) return true;
  const filter = (before: Message | PartialMessage, after: Message | PartialMessage) =>
    after.id === message.id &&
    (after as Message).embeds.length > ((before as Message)?.embeds.length ?? 0);
  try {
    await waitForMessageUpdate(client, filter, 6000);
    return true;
  } catch {
    return message.embeds.length > 0;
  }
}

export function isEmbedHealthy(embeds: Embed[]): boolean {
  return embeds.some((embed) => embed.image || embed.thumbnail || embed.video);
}

export async function waitForNativeEmbeds(message: Message, time: number): Promise<boolean> {
  if (isEmbedHealthy(message.embeds)) return true;
  let embeds = message.embeds;
  const filter = (before: Message | PartialMessage, after: Message | PartialMessage) => {
    if (after.id === message.id) embeds = (after as Message).embeds;
    return (
      after.id === message.id &&
      (after as Message).embeds.length > ((before as Message)?.embeds.length ?? 0)
    );
  };
  try {
    await waitForMessageUpdate(message.client, filter, time);
  } catch {
    // timeout: fall through and judge the last observed embeds
  }
  return isEmbedHealthy(embeds);
}

function waitForMessageUpdate(
  client: Client,
  filter: (before: Message | PartialMessage, after: Message | PartialMessage) => boolean,
  time: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for messageUpdate'));
    }, time);
    const listener = (before: Message | PartialMessage, after: Message | PartialMessage) => {
      if (filter(before, after)) {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.removeListener('messageUpdate', listener);
    };
    client.on('messageUpdate', listener);
  });
}

export async function editOriginalMessage(
  config: WebsiteConfig,
  message: Message,
  permissions: PermissionsBitField,
  client: Client,
): Promise<void> {
  if (!permissions.has(PermissionFlagsBits.ManageMessages) || config.original_message === 'nothing') return;

  if (config.original_message === 'delete') {
    await safeSend(message.delete(), { notFound: true, forbidden: true });
    return;
  }

  await waitForEmbed(message, client);
  await safeSend(message.suppressEmbeds(true), { notFound: true, forbidden: true });
  await sleep(1000);
  if (message.embeds.length > 0) {
    await safeSend(message.suppressEmbeds(true), { notFound: true, forbidden: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RevertEntry {
  senderId: string;
  fixed: Array<{ message: Message; content: string }>;
  webhook: Webhook | null;
  timer: NodeJS.Timeout;
}

const revertRegistry = new Map<string, RevertEntry>();
const REVERT_PREFIX = 'fixer_revert_';

export const KEEP_OFFER_THRESHOLD = KEEP_PROMPT_THRESHOLD;
export type PromptVariant = 'skip' | 'offer' | 'prompt';

export function promptVariant(count: number, keepAlways: boolean): PromptVariant {
  if (keepAlways) return 'skip';
  if (count >= KEEP_OFFER_THRESHOLD) return 'offer';
  return 'prompt';
}

export function revertContent(links: WebsiteLink[]): string {
  return groupItems(links, 2000, '\n', (link) => link.url)
    .map(([content]) => content)
    .join('\n');
}

export function isRevertInteractionId(customId: string): boolean {
  return customId.startsWith(REVERT_PREFIX);
}

async function registerRevertPrompt(originalMessage: Message, allSent: Array<[Message, WebsiteLink[]]>, webhook: Webhook | null, locale: string): Promise<void> {
  const guildId = originalMessage.guildId;
  const isBot = originalMessage.author.bot;
  const member = !isBot && guildId ? Filter.find('members', guildId, { id: originalMessage.author.id }) : undefined;
  const user = !isBot && !guildId ? User.find(originalMessage.author.id) : undefined;
  const variant = isBot
    ? 'prompt'
    : guildId
      ? promptVariant(member?.prompt_count ?? 0, member?.keep_always ?? false)
      : promptVariant(user?.prompt_count ?? 0, user?.keep_always ?? false);
  if (variant === 'skip') return;

  if (variant === 'offer') {
    const currentCount = guildId ? (member?.prompt_count ?? 0) : (user?.prompt_count ?? 0);
    const ignoreCount = guildId ? ((member as any)?.ignore_count ?? 0) : ((user as any)?.ignore_count ?? 0);
    if (currentCount >= KEEP_PROMPT_THRESHOLD && ignoreCount >= KEEP_IGNORE_THRESHOLD) {
      if (guildId) {
        Filter.findOrCreate('members', guildId, { id: originalMessage.author.id, bot: false }).update({ keep_always: true, ignore_count: 0 });
      } else {
        User.findOrCreate(originalMessage.author.id).update({ keep_always: true, ignore_count: 0 });
      }
      await safeSend(allSent[0][0].reply({ content: t('revert.auto.enabled', {}, locale), flags: MessageFlags.Ephemeral }), { forbidden: true });
      return;
    }
  }

  const token = Math.random().toString(36).slice(2, 10);
  const fixed = allSent.map(([msg, groupLinks]) => ({ message: msg, content: revertContent(groupLinks) }));
  const row =
    variant === 'offer'
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${REVERT_PREFIX}offer_yes_${token}`).setLabel(t('revert.offer.yes', {}, locale)).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${REVERT_PREFIX}offer_no_${token}`).setLabel(t('revert.offer.no', {}, locale)).setStyle(ButtonStyle.Secondary),
        )
      : new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${REVERT_PREFIX}keep_${token}`).setLabel(t('revert.button.keep', {}, locale)).setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${REVERT_PREFIX}do_${token}`).setLabel(t('revert.button.revert', {}, locale)).setStyle(ButtonStyle.Danger),
        );
  const content = variant === 'offer' ? t('revert.offer.title', {}, locale) : t('revert.prompt', {}, locale);
  const [ok, prompt] = await safeSend(allSent[0][0].reply({ content, components: [row] }), { forbidden: true });
  if (!ok || !prompt) return;
  const timer = setTimeout(() => {
    void prompt.delete().catch(() => {});
    revertRegistry.delete(token);
    if (!isBot) {
      if (guildId) {
        Filter.findOrCreate('members', guildId, { id: originalMessage.author.id, bot: false }).update({
          ignore_count: ((member as any)?.ignore_count ?? 0) + 1,
        });
      } else {
        const u = User.findOrCreate(originalMessage.author.id);
        u.update({ ignore_count: ((u as any).ignore_count ?? 0) + 1 });
      }
    }
  }, 60_000);
  revertRegistry.set(token, { senderId: originalMessage.author.id, fixed, webhook, timer });
  if (variant === 'prompt' && !isBot) {
    if (guildId) {
      Filter.findOrCreate('members', guildId, { id: originalMessage.author.id, bot: false }).update({
        prompt_count: (member?.prompt_count ?? 0) + 1,
      });
    } else {
      const u = User.findOrCreate(originalMessage.author.id);
      u.update({ prompt_count: u.prompt_count + 1 });
    }
  }
}

export async function handleRevertInteraction(interaction: MessageComponentInteraction): Promise<void> {
  const variants = ['offer_yes', 'offer_no', 'keep', 'do'] as const;
  const variant = variants.find((v) => interaction.customId.startsWith(`${REVERT_PREFIX}${v}_`));
  const token = variant ? interaction.customId.slice(`${REVERT_PREFIX}${variant}_`.length) : '';
  const entry = revertRegistry.get(token);
  if (!entry || !variant) {
    await interaction.deferUpdate().catch(() => {});
    return;
  }
  const locale = resolveLocale(interaction.guildId ? Guild.find(interaction.guildId) : null, interaction.locale);
  if (interaction.user.id !== entry.senderId) {
    await interaction
      .reply({ content: t('revert.error.not_yours', {}, locale), flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }
  clearTimeout(entry.timer);
  revertRegistry.delete(token);
  if (variant === 'do') {
    await Promise.all(
      entry.fixed.map(async ({ message, content }) => {
        if (entry.webhook?.token) {
          const threadId = message.channel.isThread() ? message.channelId : undefined;
          await safeSend(entry.webhook.editMessage(message.id, { content, threadId }), {
            notFound: true,
            forbidden: true,
            invalidFormBody: 'Embed size exceeds maximum size',
          });
        } else {
          await safeSend(message.edit({ content, components: [] }), { notFound: true, forbidden: true });
        }
      }),
    );
  } else if (variant === 'offer_yes') {
    if (interaction.guildId) {
      Filter.findOrCreate('members', interaction.guildId, { id: interaction.user.id, bot: false }).update({ keep_always: true });
    } else {
      User.findOrCreate(interaction.user.id).update({ keep_always: true });
    }
    await interaction.reply({ content: t('revert.offer.enabled', {}, locale), flags: MessageFlags.Ephemeral }).catch(() => {});
  } else if (variant === 'offer_no') {
    if (interaction.guildId) {
      Filter.findOrCreate('members', interaction.guildId, { id: interaction.user.id, bot: false }).update({ prompt_count: 0, ignore_count: 0 });
    } else {
      User.findOrCreate(interaction.user.id).update({ prompt_count: 0, ignore_count: 0 });
    }
  }
  await safeSend((interaction.message as Message).delete(), { notFound: true, forbidden: true });
}