import {
  Client,
  Message,
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
import { Guild } from './db';
import { type EmbeddableUrl } from './markdown';
import { websites, type WebsiteLink } from './websites';
import { groupItems, safeSend } from './utils';

export type GuildChannel = TextChannel | NewsChannel | ThreadChannel;

export function getWebsite(guild: Guild, url: string, spoiler = false): WebsiteLink | null {
  for (const website of websites) {
    const link = website.ifValid(guild, url, spoiler);
    if (link) return link;
  }
  return null;
}

export function filterFixableLinks(links: EmbeddableUrl[], guild: Guild): WebsiteLink[] {
  const out: WebsiteLink[] = [];
  for (const { url, spoiler } of links) {
    const link = getWebsite(guild, url, spoiler);
    if (link) out.push(link);
  }
  return out;
}

export async function fixEmbeds(originalMessage: Message, guild: Guild, links: WebsiteLink[], client: Client): Promise<void> {
  const channel = originalMessage.channel as GuildChannel;
  const me = originalMessage.guild?.members.me;
  if (!me || !channel.isTextBased()) return;
  const permissions = channel.permissionsFor(me);
  if (!permissions) return;
  if (
    !(permissions.has(PermissionFlagsBits.SendMessages) && permissions.has(PermissionFlagsBits.EmbedLinks)) ||
    (channel.isThread() && (channel.locked || channel.archived))
  ) {
    return;
  }

  if (!guild.reply_as_original_author_replica) {
    void channel.sendTyping();
  }

  const rendered: WebsiteLink[] = [];
  for (const link of links) {
    if (await link.render()) rendered.push(link);
  }
  let [notSent, messages] =
    rendered.length > 0 ? await sendFixedLinks(rendered, guild, originalMessage, client) : [[], []];

  let toDelete: Message[] = [];
  if (messages.length > 0) {
    const results = await Promise.all(messages.map(([msg]) => waitForEmbed(msg, client)));
    for (const [msg, failedLinks] of messages.filter((_, i) => !results[i])) {
      const retried: WebsiteLink[] = [];
      for (const link of failedLinks) {
        if (await link.retryNextFixer()) retried.push(link);
      }
      if (retried.length > 0) {
        const [notSent2, messages2] = await sendFixedLinks(retried, guild, originalMessage, client);
        notSent.push(...notSent2);
        const results2 = await Promise.all(messages2.map(([m]) => waitForEmbed(m, client)));
        toDelete.push(...messages2.filter((_, i) => !results2[i]).map(([m]) => m));
      }
      toDelete.push(msg);
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
    await editOriginalMessage(guild, originalMessage, permissions, client);
  }
}

export async function sendFixedLinks(
  renderedLinks: WebsiteLink[],
  guild: Guild,
  originalMessage: Message,
  client: Client,
): Promise<[Array<[string, WebsiteLink[]]>, Array<[Message, WebsiteLink[]]>]> {
  const channel = originalMessage.channel as GuildChannel;
  const messagesSent: Array<[Message, WebsiteLink[]]> = [];
  const linksFailed: Array<[string, WebsiteLink[]]> = [];

  const grouped = groupItems(renderedLinks, 2000, '\n', (link) => link.rendered ?? '');
  const webhook = guild.reply_as_original_author_replica ? await getOrCreateWebhook(channel, client) : null;

  for (let i = 0; i < grouped.length; i++) {
    const [messageContent, linksInGroup] = grouped[i];
    let coro: Promise<Message>;
    if (webhook) {
      coro = webhookSend(webhook, originalMessage, messageContent, guild.reply_silently);
    } else if (i === 0 && guild.reply_to_message) {
      coro = originalMessage.reply({
        content: messageContent,
        flags: guild.reply_silently ? [MessageFlags.SuppressNotifications] : undefined,
        allowedMentions: { repliedUser: false },
      });
    } else {
      coro = channel.send({
        content: messageContent,
        flags: guild.reply_silently ? [MessageFlags.SuppressNotifications] : undefined,
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
    avatarURL: originalMessage.author.displayAvatarURL(),
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
  guild: Guild,
  message: Message,
  permissions: PermissionsBitField,
  client: Client,
): Promise<void> {
  if (!permissions.has(PermissionFlagsBits.ManageMessages) || guild.original_message === 'nothing') return;

  if (guild.original_message === 'delete') {
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