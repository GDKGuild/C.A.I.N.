import { Client, Message } from 'discord.js';
import { Filter, Guild, User, type WebsiteConfig } from '../db';
import { getEmbeddableUrls, parse } from '../markdown';
import { escapeRe, type WebsiteLink } from '../websites';
import { filterFixableLinks, fixEmbeds, waitForNativeEmbeds } from '../linkFix';

const FIXER_HOSTS = new Set(['fxtwitter.com', 'fixupx.com', 'vxtwitter.com']);

function hostnameOf(url: string): string {
  return new URL(url).hostname;
}

function hasKeywords(config: WebsiteConfig, content: string): boolean {
  return config.keywords.some((k) => new RegExp(`\\b${escapeRe(k)}\\b`).test(content));
}

async function routeLinks(links: WebsiteLink[], message: Message): Promise<WebsiteLink[]> {
  const kept: WebsiteLink[] = [];
  const fixerLinks: WebsiteLink[] = [];
  for (const link of links) {
    const host = hostnameOf(link.url);
    if (FIXER_HOSTS.has(host)) {
      fixerLinks.push(link);
    } else {
      kept.push(link);
    }
  }

  if (fixerLinks.length > 0 && !(await waitForNativeEmbeds(message, 3000))) {
    for (const link of fixerLinks) {
      link.startAtNextFixer(hostnameOf(link.url));
      kept.push(link);
    }
  }

  return kept;
}

export function handleMessageCreate(client: Client, message: Message): void {
  void (async () => {
    try {
      await onMessageCreate(client, message);
    } catch (e) {
      console.warn('error in message create handler:', e);
    }
  })();
}

export async function onMessageCreate(client: Client, message: Message): Promise<void> {
  if (
    message.author.id === client.user?.id ||
    !message.content ||
    !message.channel ||
    message.system
  ) {
    return;
  }

  if (!message.guild) {
    if (!message.channel.isDMBased()) return;
    await onDmMessage(client, message);
    return;
  }

  await onGuildMessage(client, message);
}

async function onDmMessage(client: Client, message: Message): Promise<void> {
  const user = User.findOrCreate(message.author.id);
  if (!user.dm_fixing) return;

  const urls = getEmbeddableUrls(parse(message.content));
  if (urls.length === 0) return;

  const links = filterFixableLinks(urls, user);
  if (links.length === 0) return;

  if (hasKeywords(user, message.content) !== user.keywords_use_allow_list) return;

  const kept = await routeLinks(links, message);
  if (kept.length === 0) return;
  await fixEmbeds(message, user, kept, client);
}

async function onGuildMessage(client: Client, message: Message): Promise<void> {
  const urls = getEmbeddableUrls(parse(message.content));
  if (urls.length === 0) return;

  const guild = Guild.findOrCreate(message.guild!.id);
  const links = filterFixableLinks(urls, guild);
  if (links.length === 0) return;

  if (hasKeywords(guild, message.content) !== guild.keywords_use_allow_list) return;

  if (!Filter.findGetEnabled('text_channels', guild.id, { id: message.channel.id })) return;

  if (message.member && !guild.force_fix) {
    const memberEnabled = Filter.findGetEnabled('members', guild.id, {
      id: message.member.id,
      bot: message.author.bot,
    });
    const rolesEnabled = Filter.findsGetEnabled('roles', guild.id, Array.from(message.member.roles.cache.values()));
    const rolesOk = guild.roles_use_any_rule ? rolesEnabled.some(Boolean) : rolesEnabled.every(Boolean);
    if (!memberEnabled || !rolesOk) return;
  }

  if (message.webhookId !== null && !guild.webhooks) return;

  const kept = await routeLinks(links, message);
  if (kept.length === 0) return;
  await fixEmbeds(message, guild, kept, client);
}
