import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  GuildMember,
  MessageActionRowComponentBuilder,
  MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
} from 'discord.js';
import { CustomFixer, FixerManager, Guild as GuildModel } from '../db';
import { getFixers } from '../fixers';
import { t } from '../i18n';
import { isAdmin, isServerOwner } from '../permissions';
import { packRows } from '../views/settings';
import { websites, CustomLink, GenericWebsiteLink } from '../websites';

type Interactive = MessageComponentInteraction | ModalSubmitInteraction;
type Callback = (interaction: Interactive) => Promise<void>;

interface RowItem {
  builder: MessageActionRowComponentBuilder;
  row?: number;
}

const NAME_MAP: Record<string, string> = { twitter: 'Twitter/X', instagram: 'Instagram' };
function nameOf(cls: typeof GenericWebsiteLink): string {
  return NAME_MAP[cls.id] ?? (cls.hypertextLabel || cls.id);
}

const TWITTER_PATH = /^\/(?:[^/]+)\/status(?:es)?\/\d+/i;
const INSTAGRAM_PATH = /^\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+/;

function detectWebsite(url: URL): string | null {
  if (TWITTER_PATH.test(url.pathname)) return 'twitter';
  if (INSTAGRAM_PATH.test(url.pathname)) return 'instagram';
  return null;
}

function deriveDomain(host: string): string | null {
  let h = host.toLowerCase().replace(/^www\./, '').replace(/^(g|d|t)\./, '');
  if (!h.includes('.') || /\s/.test(h)) return null;
  return h;
}

export function parseFixerLink(raw: string): { website: string; domain: string } | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const website = detectWebsite(url);
  if (!website) return null;
  const domain = deriveDomain(url.hostname);
  if (!domain) return null;
  return { website, domain };
}

const SOURCE_DOMAINS: Record<string, string[]> = {
  twitter: ['twitter.com', 'x.com'],
  instagram: ['instagram.com'],
};

function canManage(guild: NonNullable<Interactive['guild']>, member: GuildMember): boolean {
  if (isServerOwner(guild, member)) return true;
  if (isAdmin(guild, member)) return true;
  const managers = FixerManager.findAllByGuild(guild.id);
  if (managers.some((m) => m.type === 'member' && m.target_id === member.id)) return true;
  const roleIds = new Set(member.roles.cache.keys());
  return managers.some((m) => m.type === 'role' && roleIds.has(m.target_id));
}

async function reachable(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}/`, { method: 'HEAD', signal: AbortSignal.timeout(8000), redirect: 'follow' });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

function buildDescription(guild: GuildModel, locale: string): string {
  const blocks: string[] = [];
  const customs = CustomFixer.findAllByGuild(guild.id);

  for (const cls of websites) {
    if (cls === CustomLink) continue; // custom websites: not fixer sites
    const site = cls as typeof GenericWebsiteLink;
    const registry = getFixers(site.id);
    const siteCustoms = customs.filter((c) => c.website === site.id);
    if (registry.length === 0 && siteCustoms.length === 0) {
      blocks.push(`**${nameOf(site)}**: ${site.fixDomain ?? site.fixerName}`);
    } else {
      blocks.push(`**${nameOf(site)}**`);
      for (const f of registry) {
        const tag = f.default ? ' — default' : '';
        blocks.push(` \`${f.domain}\`${tag}`);
      }
      for (const c of siteCustoms) {
        blocks.push(` \`${c.fix_domain}\` — custom`);
      }
    }
    blocks.push(''); // blank line between blocks
  }

  if (blocks.length > 0 && blocks[blocks.length - 1] === '') blocks.pop(); // trim trailing blank

  return blocks.join('\n');
}

function buildAddButton(locale: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId('fixer_add')
    .setStyle(ButtonStyle.Secondary)
    .setLabel(t('list.buttons.add', {}, locale));
}

function buildRemoveButton(customsCount: number, locale: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId('fixer_remove')
    .setStyle(ButtonStyle.Secondary)
    .setLabel(t('list.buttons.remove', {}, locale))
    .setDisabled(customsCount === 0);
}

class ListController {
  guild: GuildModel;
  key: string;
  callbacks = new Map<string, Callback>();
  private deleteTimer: NodeJS.Timeout | null = null;
  private locale: string;
  private isInitial = false;
  private removing = false;

  constructor(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) throw new Error('list view requires a guild');
    this.guild = GuildModel.find(interaction.guild.id)!;
    this.key = `${interaction.guild.id}:${interaction.user.id}`;
    this.locale = interaction.locale;
  }

  register(customId: string, callback: Callback): void {
    this.callbacks.set(customId, callback);
  }

  private buildComponents(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const customsCount = CustomFixer.findAllByGuild(this.guild.id).length;
    const items: RowItem[] = [
      { builder: buildAddButton(this.locale) },
      { builder: buildRemoveButton(customsCount, this.locale) },
    ];

    if (this.removing && customsCount > 0) {
      const customs = CustomFixer.findAllByGuild(this.guild.id);
      const options = customs.map((c) => {
        const label = `${nameById(c.website)} — ${c.fix_domain}`;
        return new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(c.id));
      });
      const select = new StringSelectMenuBuilder()
        .setCustomId('fixer_pick')
        .setPlaceholder(t('list.remove.select', {}, this.locale))
        .addOptions(options);
      items.push({ builder: select, row: 2 });
    }
    return packRows(items);
  }

  async refresh(interaction: Interactive): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle(t('list.title', {}, this.locale))
      .setDescription(buildDescription(this.guild, this.locale));
    this.setFooter(embed);
    try {
      if (interaction.isModalSubmit() && !interaction.isFromMessage()) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      await interaction.update({ embeds: [embed], components: this.buildComponents() });
    } catch (e) {
      console.error('list view send error:', e);
      if (interaction.isMessageComponent()) await interaction.deferUpdate().catch(() => {});
    }
    this.resetTimeout(interaction);
  }

  async send(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    this.isInitial = true;
    this.resetTimeout(interaction);
    activeLists.set(this.key, this);

    const embed = new EmbedBuilder()
      .setTitle(t('list.title', {}, this.locale))
      .setDescription(buildDescription(this.guild, this.locale));
    this.setFooter(embed);

    try {
      await interaction.editReply({ embeds: [embed], components: this.buildComponents() });
    } catch (e) {
      console.error('list view build error:', e);
      await interaction.editReply({ content: t('list.error', {}, this.locale) }).catch(() => {});
    }
  }

  private setFooter(embed: EmbedBuilder): void {
    const strategyLabel = t(`settings.fixer_strategy.strategy.${this.guild.fixer_strategy}`, {}, this.locale);
    embed.setFooter({
      text: `${t('list.footer', { strategy: strategyLabel, settings_command: t('settings.command.name', {}, this.locale) }, this.locale)}`,
    });
  }

  private resetTimeout(interaction: ChatInputCommandInteraction | Interactive): void {
    if (this.deleteTimer) clearTimeout(this.deleteTimer);
    const ctrl = this;
    this.deleteTimer = setTimeout(() => {
      void interaction.deleteReply().catch(() => {});
      if (ctrl.isInitial) activeLists.delete(ctrl.key);
    }, 180_000);
  }

  async addAction(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    if (interaction.guild) {
      const member = interaction.member as GuildMember;
      if (!canManage(interaction.guild, member)) {
        await interaction.reply({ content: t('list.error.no_permission', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
    }
    const modal = new ModalBuilder()
      .setCustomId('fixer_link')
      .setTitle(t('list.add_modal.title', {}, this.locale))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('link')
            .setLabel(t('list.add_modal.label', {}, this.locale))
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(t('list.add_modal.placeholder', {}, this.locale))
            .setRequired(true),
        ),
      );
    await interaction.showModal(modal);
  }

  async removeAction(interaction: Interactive): Promise<void> {
    if (interaction.guild) {
      const member = interaction.member as GuildMember;
      if (!canManage(interaction.guild, member)) {
        await interaction.reply({ content: t('list.error.no_permission', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
    }
    const customsCount = CustomFixer.findAllByGuild(this.guild.id).length;
    if (customsCount === 0) {
      await interaction.reply({ content: t('list.error.no_custom', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    this.removing = true;
    await this.refresh(interaction);
  }

  async pickAction(interaction: Interactive): Promise<void> {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.guild) {
      const member = interaction.member as GuildMember;
      if (!canManage(interaction.guild, member)) {
        await interaction.reply({ content: t('list.error.no_permission', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
    }
    const id = Number(interaction.values[0]);
    const cf = CustomFixer.find(id);
    if (cf) cf.delete();
    this.removing = false;
    await this.refresh(interaction);
  }

  async linkModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (interaction.guild) {
      const member = interaction.member as GuildMember;
      if (!canManage(interaction.guild, member)) {
        await interaction.reply({ content: t('list.error.no_permission', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
    }
    const raw = interaction.fields.getTextInputValue('link');
    const parsed = parseFixerLink(raw);
    if (!parsed) {
      await interaction.reply({ content: t('list.add_modal.error.invalid_url', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const { website, domain } = parsed;
    const registry = getFixers(website);
    const customs = CustomFixer.findAllByGuild(this.guild.id).filter((c) => c.website === website);
    if ((SOURCE_DOMAINS[website] ?? []).includes(domain)) {
      await interaction.reply({ content: t('list.add_modal.error.own_domain', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (registry.some((f) => f.domain === domain) || customs.some((c) => c.fix_domain === domain)) {
      await interaction.reply({ content: t('list.add_modal.error.duplicate', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (customs.length >= 4) {
      await interaction.reply({ content: t('list.add_modal.error.limit', {}, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (!(await reachable(domain))) {
      await interaction.reply({ content: t('list.add_modal.error.unreachable', { url: `https://${domain}/` }, this.locale), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    CustomFixer.create(this.guild.id, website, domain);
    this.removing = false;
    await this.refresh(interaction);
  }
}

function nameById(websiteId: string): string {
  const cls = websites.find((w) => w.id === websiteId && w !== CustomLink) as typeof GenericWebsiteLink | undefined;
  return cls ? nameOf(cls) : websiteId;
}

const activeLists = new Map<string, ListController>();

function listKey(interaction: Interactive): string {
  return `${interaction.guild?.id ?? ''}:${interaction.user.id}`;
}

export function isListInteractionId(customId: string): boolean {
  return customId === 'fixer_add' || customId === 'fixer_remove' || customId === 'fixer_pick' || customId === 'fixer_link';
}

export async function handleListInteraction(interaction: Interactive): Promise<void> {
  if (!isListInteractionId(interaction.customId)) return;
  const view = activeLists.get(listKey(interaction));
  if (!view) {
    if (interaction.isMessageComponent()) await interaction.deferUpdate().catch(() => {});
    return;
  }
  const callback = view.callbacks.get(interaction.customId);
  if (!callback) {
    if (interaction.isMessageComponent()) await interaction.deferUpdate().catch(() => {});
    return;
  }
  try {
    await callback(interaction);
  } catch (e) {
    console.error('list view error:', e);
    if (interaction.isMessageComponent()) await interaction.deferUpdate().catch(() => {});
  }
}

export async function listCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const ctrl = new ListController(interaction);
  ctrl.register('fixer_add', (i) => ctrl.addAction(i));
  ctrl.register('fixer_remove', (i) => ctrl.removeAction(i));
  ctrl.register('fixer_pick', (i) => ctrl.pickAction(i));
  ctrl.register('fixer_link', (i) => ctrl.linkModal(i as ModalSubmitInteraction));
  await ctrl.send(interaction);
}
