import {
  Client,
  DiscordAPIError,
  EmbedBuilder,
  escapeMarkdown,
  GuildChannel,
  PermissionFlagsBits,
  ThreadChannel,
} from 'discord.js';
import { HTTPError } from 'discord.js';
import { VERSION } from './config';
import { t } from './i18n';

export function boolString(value: unknown): string {
  return String(value).toLowerCase();
}

export type PermChannel = GuildChannel | ThreadChannel;

const PERM_FLAGS: Record<string, bigint> = {
  view_channel: PermissionFlagsBits.ViewChannel,
  send_messages: PermissionFlagsBits.SendMessages,
  embed_links: PermissionFlagsBits.EmbedLinks,
  send_messages_in_threads: PermissionFlagsBits.SendMessagesInThreads,
  manage_messages: PermissionFlagsBits.ManageMessages,
  read_message_history: PermissionFlagsBits.ReadMessageHistory,
  manage_webhooks: PermissionFlagsBits.ManageWebhooks,
};

export function mentionOf(channel: GuildChannel | ThreadChannel): string {
  return channel.toString();
}

export function formatPerms(
  perms: string[],
  channel: PermChannel,
  includeLabel = true,
  includeValid = false,
): string {
  if (perms.length === 0) return '';
  const bot = channel.guild.members.me;
  const channelPermissions = bot ? channel.permissionsFor(bot) : null;
  const guildPermissions = bot ? bot.permissions : null;
  const lines: string[] = [];
  for (const perm of perms) {
    const has = channelPermissions?.has(PERM_FLAGS[perm]) ?? false;
    if (!includeValid && !has) continue;
    const scope = has
      ? ''
      : t('settings.perms.scope', {
          scope: guildPermissions?.has(PERM_FLAGS[perm])
            ? mentionOf(channel)
            : `\`${escapeMarkdown(channel.guild.name)}\``,
        });
    lines.push(`- ${t(`settings.perms.${perm}.${boolString(has)}`)}${scope}`);
  }
  if (includeLabel && lines.length > 0) {
    return t(includeValid ? 'settings.perms.label' : 'settings.perms.missing_label', {
      channel: mentionOf(channel),
    }) + lines.join('\n');
  }
  return lines.join('\n');
}

export function isMissingPerm(perms: string[], channel: PermChannel): boolean {
  if (perms.length === 0) return false;
  const channelPermissions = channel.guild.members.me
    ? channel.permissionsFor(channel.guild.members.me)
    : null;
  return perms.some((perm) => !(channelPermissions?.has(PERM_FLAGS[perm]) ?? false));
}

export function groupItems<T>(items: Array<T>, maxGroupSize: number, sep = '\n', stringify: (item: T) => string = String): Array<[string, Array<T>]> {
  const groups: Array<[string, Array<T>]> = [];
  for (const item of items) {
    const itemStr = stringify(item);
    if (groups.length === 0) {
      groups.push([itemStr, [item]]);
    } else if (groups[groups.length - 1][0].length + sep.length + itemStr.length <= maxGroupSize) {
      const [groupStr, groupItems] = groups[groups.length - 1];
      groups[groups.length - 1] = [groupStr + sep + itemStr, [...groupItems, item]];
    } else {
      groups.push([itemStr, [item]]);
    }
  }
  return groups;
}

export function groupJoin(strings: Array<string>, maxGroupSize: number, sep = '\n'): Array<string> {
  return groupItems(strings, maxGroupSize, sep).map(([group]) => group);
}

export function setEmbedFooter(client: Client, embed: EmbedBuilder): void {
  embed.setFooter({ text: `${client.user?.username ?? 'C.A.I.N.'} v${VERSION}` });
}

export interface SafeSendOptions {
  rateLimit?: boolean;
  invalidFormBody?: boolean | string | Array<string>;
  notFound?: boolean;
  forbidden?: boolean;
  statusCodes?: Array<number>;
  errorCodes?: Array<number>;
}

export async function safeSend<T>(coro: Promise<T>, options: SafeSendOptions = {}): Promise<[boolean, T | null]> {
  const {
    rateLimit = true,
    invalidFormBody = false,
    notFound = false,
    forbidden = false,
    statusCodes = [],
    errorCodes = [],
  } = options;
  try {
    return [true, await coro];
  } catch (e) {
    const isHttp = e instanceof HTTPError || e instanceof DiscordAPIError;
    const status = (e as { status?: number }).status;
    const code = (e as { code?: number }).code;
    const text = (e as { message?: string }).message ?? '';

    let msg: string = '';
    let handled = false;

    if (isHttp && rateLimit && status === 429) {
      msg = 'Failed to send coroutine due to rate limiting.';
      handled = true;
    } else if (isHttp && notFound && status === 404) {
      msg = `Failed to send coroutine due to NotFound error.\nError:\n${text}`;
      handled = true;
    } else if (isHttp && forbidden && status === 403) {
      msg = `Failed to send coroutine due to Forbidden error.\nError:\n${text}`;
      handled = true;
    } else if (isHttp && invalidFormBody && code === 50035 &&
      (invalidFormBody === true ||
        (typeof invalidFormBody === 'string' && text.includes(invalidFormBody)) ||
        (Array.isArray(invalidFormBody) && invalidFormBody.some((m) => text.includes(m))))) {
      msg = `Failed to send coroutine due to invalid form body.\nError:\n${text}`;
      handled = true;
    } else if (isHttp && status != null && statusCodes.includes(status)) {
      msg = `Failed to send coroutine due to HTTP status ${status}.\nError:\n${text}`;
      handled = true;
    } else if (isHttp && code != null && errorCodes.includes(code)) {
      msg = `Failed to send coroutine due to HTTP error code ${code}.\nError:\n${text}`;
      handled = true;
    }

    if (!handled) throw e;
    console.warn(msg.replace(/\n/g, ' '));
    return [false, null];
  }
}