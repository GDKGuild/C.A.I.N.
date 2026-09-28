import { ChatInputCommandInteraction, Client, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from 'discord.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import config from '../../config.json';
import { t } from '../i18n';

const GIFS_DIR = path.join(__dirname, '..', '..', 'gifs');

export function listGifs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gif'));
}

export function pickGif(gifs: string[]): string | undefined {
  if (gifs.length === 0) return undefined;
  return gifs[Math.floor(Math.random() * gifs.length)];
}

export function eventCommandBuilder(): SlashCommandOptionsOnlyBuilder {
  return new SlashCommandBuilder()
    .setName(config.event_command.name)
    .setDescription(t('event.command.description'))
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName('user').setDescription(t('event.option.user.description')).setRequired(false),
    );
}

export type HealContext = 'self' | 'other' | 'bot';

const DIALOGUE_KEYS: Record<HealContext, string[]> = {
  self: ['event.self.0', 'event.self.1', 'event.self.2', 'event.self.3'],
  other: ['event.other.0', 'event.other.1', 'event.other.2'],
  bot: ['event.bot.0', 'event.bot.1', 'event.bot.2'],
};

export function healContext(selectedUserId: string | null, botId: string): HealContext {
  if (selectedUserId !== null && selectedUserId === botId) return 'bot';
  return selectedUserId !== null ? 'other' : 'self';
}

export function pickDialogueKey(context: HealContext): string {
  const keys = DIALOGUE_KEYS[context];
  return keys[Math.floor(Math.random() * keys.length)];
}

export async function eventCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const botName = client.user?.username ?? 'C.A.I.N.';
  const selected = interaction.options.getUser('user');
  const context = healContext(selected ? selected.id : null, client.user?.id ?? '');

  let actor: string;
  let target: string;
  if (context === 'bot') {
    actor = interaction.user.displayName;
    target = botName;
  } else {
    actor = botName;
    target = selected ? selected.toString() : t('event.you', {}, interaction.locale);
  }

  const content = t(pickDialogueKey(context), { actor, target }, interaction.locale);

  const gif = pickGif(listGifs(GIFS_DIR));
  if (gif) {
    await interaction.reply({ content, files: [path.join(GIFS_DIR, gif)] });
    return;
  }
  await interaction.reply({ content });
}