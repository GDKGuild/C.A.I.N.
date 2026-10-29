import { ChatInputCommandInteraction, Client, InteractionContextType, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from 'discord.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import config from '../../config.json';
import { t, resolveLocale } from '../i18n';
import { Guild as GuildModel } from '../db';

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
    .setContexts([InteractionContextType.Guild])
    .addUserOption((o) =>
      o.setName('user').setDescription(t('event.option.user.description')).setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('Pick which dialogue to use')
        .setRequired(false)
        .addChoices(
          { name: 'rape', value: 'rape' },
          { name: 'molest', value: 'molest' },
          { name: 'impregnate', value: 'impregnate' },
        ),
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

const ACTION_TO_INDEX: Record<string, number> = {
  rape: 0,
  molest: 1,
  impregnate: 2,
};

export async function eventCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const botName = client.user?.username ?? 'C.A.I.N.';
  const invokerMention = interaction.user.toString();
  const selected = interaction.options.getUser('user');
  const action = interaction.options.getString('action');
  const context = healContext(selected ? selected.id : null, client.user?.id ?? '');
  const guild = interaction.guildId ? GuildModel.find(interaction.guildId) : null;
  const locale = resolveLocale(guild, interaction.locale);

  let actor: string;
  let target: string;
  if (context === 'self') {
    actor = botName;
    target = t('event.you', {}, locale);
  } else if (context === 'bot') {
    actor = invokerMention;
    target = botName;
  } else {
    actor = invokerMention;
    target = selected!.toString();
  }

  let dialogueKey: string;
  if (action && ACTION_TO_INDEX[action] !== undefined) {
    const keys = DIALOGUE_KEYS[context];
    dialogueKey = keys[ACTION_TO_INDEX[action]] ?? pickDialogueKey(context);
  } else {
    dialogueKey = pickDialogueKey(context);
  }
  const content = t(dialogueKey, { actor, target }, locale);

  const gif = pickGif(listGifs(GIFS_DIR));
  if (gif) {
    await interaction.reply({ content, files: [path.join(GIFS_DIR, gif)] });
    return;
  }
  await interaction.reply({ content });
}