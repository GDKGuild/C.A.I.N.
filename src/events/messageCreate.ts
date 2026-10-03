import { Client, Message } from 'discord.js';
import { Filter, Guild } from '../db';
import { getEmbeddableUrls, parse } from '../markdown';
import { escapeRe } from '../websites';
import { filterFixableLinks, fixEmbeds, waitForNativeEmbeds } from '../linkFix';

const PLAIN_HOSTS = new Set(['twitter.com', 'x.com', 'pixiv.net']);
const FIXER_HOSTS = new Set(['fxtwitter.com', 'fixupx.com', 'vxtwitter.com']);

function hostnameOf(url: string): string {
  return new URL(url).hostname;
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
    message.author.id === message.guild?.members.me?.id ||
    !message.content ||
    !message.channel ||
    !message.guild ||
    message.system
  ) {
    return;
  }

  const urls = getEmbeddableUrls(parse(message.content));
  if (urls.length === 0) return;

  const guild = Guild.findOrCreate(message.guild.id);
  const links = filterFixableLinks(urls, guild);
  if (links.length === 0) return;

  const keywordsFound = guild.keywords.some((k) => new RegExp(`\\b${escapeRe(k)}\\b`).test(message.content));
  if (keywordsFound !== guild.keywords_use_allow_list) return;

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

  const kept: Array<(typeof links)[number]> = [];
  const fixerLinks: Array<(typeof links)[number]> = [];
  for (const link of links) {
    const host = hostnameOf(link.url);
    if (PLAIN_HOSTS.has(host)) {
      kept.push(link);
    } else if (FIXER_HOSTS.has(host)) {
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

  if (kept.length === 0) return;
  await fixEmbeds(message, guild, kept, client);
}