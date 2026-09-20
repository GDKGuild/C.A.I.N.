import {
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  MessageComponentInteraction,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionsBitField,
} from 'discord.js';
import { BOT_OWNER_IDS } from './config';
import { t } from './i18n';

export function isBotOwner(client: Client, userId: string): boolean {
  if (BOT_OWNER_IDS.has(userId)) return true;
  const owner = client.application?.owner;
  if (!owner) return false;
  if ('members' in owner) return owner.members.has(userId);
  return owner.id === userId;
}

export function isServerOwner(guild: Guild, member: GuildMember): boolean {
  return guild.ownerId === member.id;
}

export function isAdmin(guild: Guild, member: GuildMember): boolean {
  // ponytail: derive from guild roles cache, not member.permissions — the latter can
  // hold a stale cached bitfield from a REST hydrate done before the admin grant.
  for (const id of member.roles.cache.keys()) {
    if (guild.roles.cache.get(id)?.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  }
  return false;
}

export function canUseSettings(client: Client, guild: Guild, member: GuildMember): boolean {
  return isBotOwner(client, member.id) || isServerOwner(guild, member) || isAdmin(guild, member);
}

type DeniableInteraction = ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

export async function denySettings(interaction: DeniableInteraction): Promise<void> {
  await interaction
    .reply({ content: t('settings.error.permission', {}, interaction.locale), flags: MessageFlags.Ephemeral })
    .catch(() => {});
}