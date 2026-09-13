import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Guild as DiscordGuild,
  GuildChannel,
  GuildMember,
  MentionableSelectMenuBuilder,
  MessageActionRowComponentBuilder,
  MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  Role,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadChannel,
  UserSelectMenuBuilder,
} from 'discord.js';
import { CustomWebsite, Filter, FilterTable, Guild as GuildModel, OriginalMessage } from '../db';
import { EMOJI, LINKS } from '../config';
import { t } from '../i18n';
import { boolString, formatPerms, isMissingPerm, mentionOf, setEmbedFooter } from '../utils';

const ORIGINAL_MESSAGES: OriginalMessage[] = ['nothing', 'remove_embeds', 'delete'];
const FX_EMBED_VIEWS = ['normal', 'gallery', 'text_only', 'direct_media'];
const INSTAGRAM_VIEWS = ['normal', 'direct_media', 'gallery'];
const TIKTOK_VIEWS = ['normal', 'gallery', 'direct_media'];
const EMBEDEZ_VIEWS = ['normal', 'direct_media'];

const CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.AnnouncementThread,
  ChannelType.GuildPublicThread,
  ChannelType.GuildPrivateThread,
];

function isThreadChannel(obj: GuildChannel | ThreadChannel | GuildMember | Role): boolean {
  return obj instanceof ThreadChannel || ('isThread' in obj && obj.isThread());
}

type Interactive = MessageComponentInteraction | ModalSubmitInteraction;
type Callback = (interaction: Interactive) => Promise<void>;

interface RowItem {
  builder: MessageActionRowComponentBuilder;
  row?: number;
}

const WIDE_COMPONENTS = new Set([
  StringSelectMenuBuilder.name,
  ChannelSelectMenuBuilder.name,
  UserSelectMenuBuilder.name,
  RoleSelectMenuBuilder.name,
  MentionableSelectMenuBuilder.name,
]);

function componentWidth(builder: MessageActionRowComponentBuilder): number {
  return WIDE_COMPONENTS.has(builder.constructor.name) ? 5 : 1;
}

export function packRows(items: RowItem[]): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: MessageActionRowComponentBuilder[][] = [];
  const usedWidth: number[] = [];
  for (const item of items) {
    const width = componentWidth(item.builder);
    let idx = item.row !== undefined
      ? Math.min(4, Math.max(0, item.row))
      : rows.findIndex((r, i) => (usedWidth[i] ?? 0) + width <= 5);
    if (idx === -1) idx = rows.length;
    while (rows.length <= idx) {
      rows.push([]);
      usedWidth.push(0);
    }
    usedWidth[idx] = (usedWidth[idx] ?? 0) + width;
    rows[idx].push(item.builder);
  }
  return rows.filter((r) => r.length > 0).map((r) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(r));
}

function button(style: ButtonStyle, label: string, disabled = false): ButtonBuilder {
  return new ButtonBuilder().setStyle(style).setLabel(label).setDisabled(disabled);
}

function toDElement(
  table: FilterTable,
  obj: GuildChannel | ThreadChannel | GuildMember | Role,
): { id?: string | bigint; user?: { id: string | bigint }; bot?: boolean } {
  if (table === 'members') {
    const m = obj as GuildMember;
    return { id: m.id, user: { id: m.id }, bot: m.user.bot };
  }
  return { id: (obj as { id: string }).id };
}

class FilterElement {
  table: FilterTable;
  guildId: string;
  discordObject: GuildChannel | ThreadChannel | GuildMember | Role;
  dbObject: Filter;

  constructor(table: FilterTable, guildId: string, obj: GuildChannel | ThreadChannel | GuildMember | Role) {
    this.table = table;
    this.guildId = guildId;
    this.discordObject = obj;
    this.dbObject = Filter.findOrCreate(table, guildId, toDElement(table, obj));
  }

  replace(obj: GuildChannel | ThreadChannel | GuildMember | Role): void {
    this.discordObject = obj;
    this.dbObject = Filter.findOrCreate(this.table, this.guildId, toDElement(this.table, obj));
  }

  enabled(guild: GuildModel): boolean {
    return this.dbObject.enabled(guild);
  }

  onList(guild: GuildModel): boolean {
    return this.dbObject.onList(guild);
  }

  updateEnabled(enabled: boolean, guild: GuildModel): void {
    this.dbObject.updateEnabled(enabled, guild);
  }

  get mention(): string {
    return this.discordObject.toString();
  }
}

class HybridElement<D extends { id: string }, M> {
  discordObject: D;
  dbObject: M;

  constructor(discordObject: D, dbObject: M) {
    this.discordObject = discordObject;
    this.dbObject = dbObject;
  }
}

class DataElements {
  guild: HybridElement<DiscordGuild, GuildModel>;
  member: FilterElement;
  channel: FilterElement;
  role: FilterElement;
  roles: FilterElement[];

  constructor(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member || !interaction.channel) {
      throw new Error('settings view requires a guild context');
    }
    const guildId = interaction.guild.id;
    this.guild = new HybridElement(interaction.guild, GuildModel.findOrCreate(guildId));
    const guild = this.guild.dbObject;
    this.member = new FilterElement('members', guildId, interaction.member as GuildMember);
    this.channel = new FilterElement('text_channels', guildId, interaction.channel as GuildChannel);
    this.role = new FilterElement(
      'roles',
      guildId,
      (interaction.member as GuildMember).roles.highest,
    );
    this.roles = [...(interaction.member as GuildMember).roles.cache.values()].map(
      (r) => new FilterElement('roles', guildId, r),
    );
    void guild;
  }

  refresh(): void {
    const guildId = this.guild.discordObject.id;
    this.guild.dbObject = GuildModel.find(guildId) ?? GuildModel.findOrCreate(guildId);
    this.member.dbObject = Filter.findOrCreate('members', this.member.guildId, toDElement('members', this.member.discordObject));
    this.channel.dbObject = Filter.findOrCreate('text_channels', this.channel.guildId, toDElement('text_channels', this.channel.discordObject));
    this.role.dbObject = Filter.findOrCreate('roles', this.role.guildId, toDElement('roles', this.role.discordObject));
    this.roles = [...(this.member.discordObject as GuildMember).roles.cache.values()].map(
      (r) => new FilterElement('roles', this.member.guildId, r),
    );
  }
}

abstract class BaseSetting {
  declare id: string;
  declare name: string;
  declare description: string;
  declare emoji: string | null;

  interaction: ChatInputCommandInteraction | MessageComponentInteraction;
  bot: Client;
  view: SettingsView;
  ctx: DataElements;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    this.interaction = interaction;
    this.bot = interaction.client;
    this.view = view;
    this.ctx = ctx;
  }

  get guild(): GuildModel {
    return this.ctx.guild.dbObject;
  }

  async embed(): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle(this.emoji ? `${this.emoji} ${t(this.name)}` : t(this.name))
      .setDescription(t(this.description));
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async option(): Promise<StringSelectMenuOptionBuilder> {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(t(this.name))
      .setValue(this.id)
      .setDescription(t(this.description));
    if (this.emoji) option.setEmoji(this.emoji);
    return option;
  }

  async items(): Promise<Array<RowItem>> {
    return [];
  }
}

abstract class WebsiteBaseSetting extends BaseSetting {
  declare proxies: Record<string, string>;
  description = '';
  is_view = false;
  is_translation = false;
  view_enum: string[] | null = null;

  declare state: boolean;
  declare view_state: string | null;
  declare translation: boolean | null;
  declare lang: string | null;
  private initStateDone = false;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(interaction, view, ctx);
  }

  private initState(): void {
    if (this.initStateDone) return;
    this.initStateDone = true;
    this.state = boolString(this.guild[this.id as keyof GuildModel]) === 'true';
    if (this.is_view) {
      this.view_state = String(this.guild[`${this.id}_view` as keyof GuildModel]);
    }
    if (this.is_translation) {
      this.translation = boolString(this.guild[`${this.id}_tr` as keyof GuildModel]) === 'true';
      this.lang = this.guild.lang;
    }
  }

  async embed(): Promise<EmbedBuilder> {
    this.initState();
    this.lang = this.is_translation ? this.guild.lang : null;
    const name = t(this.name);
    const embed = new EmbedBuilder().setTitle(this.emoji ? `${this.emoji} ${name}` : name).setDescription(
      t('settings.base_website.content', {
        name,
        state: t(
          `settings.base_website.state.${boolString(this.state)}`,
          {
            name,
            translation:
              this.is_translation && this.state
                ? t(`settings.base_website.translation.${boolString(this.translation)}`, { lang: this.lang })
                : '',
          },
        ),
        view:
          this.view_state
            ? '\n' + t(`settings.base_website.view.${this.view_state}.emoji`) + ' ' + t(`settings.base_website.view.${this.view_state}.label`)
            : '',
        credits: Object.entries(this.proxies).map(([pName, pUrl]) => `[${pName}](<${pUrl}>)`).join(t('settings.base_website.credits_separator')),
      }),
    );
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async items(): Promise<Array<RowItem>> {
    this.initState();
    this.lang = this.is_translation ? this.guild.lang : null;
    const items: Array<RowItem> = [];

    const stateSwitch = button(
      this.state ? ButtonStyle.Primary : ButtonStyle.Secondary,
      t(`settings.base_website.button.state.${boolString(this.state)}`),
    ).setCustomId(this.id);
    this.view.register(this.id, (i) => this.action(i));
    items.push({ builder: stateSwitch });

    if (this.is_translation) {
      const translationButton = button(
        this.translation && this.state ? ButtonStyle.Primary : ButtonStyle.Secondary,
        t(`settings.base_website.button.translation.${boolString(Boolean(this.translation && this.state))}`, { lang: this.lang }),
        !this.state,
      ).setCustomId(`${this.id}_translation`);
      this.view.register(`${this.id}_translation`, (i) => this.translationAction(i));
      items.push({ builder: translationButton });

      const translationLangButton = button(
        ButtonStyle.Success,
        t('settings.base_website.button.translation_lang'),
        !(this.translation && this.state),
      ).setCustomId(`${this.id}_translation_lang`);
      this.view.register(`${this.id}_translation_lang`, (i) => this.translationLangAction(i));
      items.push({ builder: translationLangButton });
    }

    if (this.is_view && this.view_enum) {
      const viewSelector = new StringSelectMenuBuilder()
        .setCustomId(`${this.id}_view`)
        .setMaxValues(1)
        .addOptions(
          this.view_enum.map((view) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(t(`settings.base_website.view.${view}.label`))
              .setEmoji(t(`settings.base_website.view.${view}.emoji`))
              .setValue(view)
              .setDefault(view === this.view_state),
          ),
        );
      this.view.register(`${this.id}_view`, (i) => this.viewAction(i));
      items.push({ builder: viewSelector });
    }

    return items;
  }

  async action(interaction: Interactive): Promise<void> {
    this.state = !this.state;
    this.guild.update({ [this.id]: this.state } as Partial<GuildModel>);
    await this.view.refresh(interaction);
  }

  async translationAction(interaction: Interactive): Promise<void> {
    this.translation = !this.translation;
    if (this.guild.lang === null) {
      this.lang = interaction.locale.split('-')[0];
    }
    this.guild.update({ [`${this.id}_tr`]: this.translation, lang: this.lang } as Partial<GuildModel>);
    await this.view.refresh(interaction);
  }

  async translationLangAction(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    await this.view.resetTimeout(interaction);
    const setting = this;
    await interaction.showModal(this.buildLangModal());
    this.view.register('lang_modal', (i) => this.submitLangModal(setting, i));
  }

  buildLangModal(): ModalBuilder {
    const lang = this.guild.lang;
    const interactionLang = this.interaction.locale.split('-')[0];
    const langInput = new TextInputBuilder()
      .setCustomId('lang')
      .setLabel(t('settings.lang_modal.label'))
      .setPlaceholder(t('settings.lang_modal.placeholder', { lang_iso: interactionLang }))
      .setMinLength(1)
      .setMaxLength(2)
      .setStyle(TextInputStyle.Short);
    if (lang) langInput.setValue(lang);
    return new ModalBuilder()
      .setCustomId('lang_modal')
      .setTitle(t('settings.lang_modal.title'))
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(langInput));
  }

  async submitLangModal(setting: WebsiteBaseSetting, interaction: Interactive): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    const lang = interaction.fields.getTextInputValue('lang');
    if (lang.length !== 2) {
      await interaction.reply({
        content: t('settings.lang_modal.error', {
          invalid_lang: lang,
          lang_iso: interaction.locale.split('-')[0],
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setting.guild.update({ lang });
    await setting.view.refresh(interaction);
  }

  async viewAction(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    if (!interaction.isStringSelectMenu()) return;
    if (!this.is_view) {
      await this.view.refresh(interaction);
      return;
    }
    this.view_state = interaction.values[0];
    this.guild.update({ [`${this.id}_view`]: this.view_state } as Partial<GuildModel>);
    await this.view.refresh(interaction);
  }

  async option(): Promise<StringSelectMenuOptionBuilder> {
    this.initState();
    const name = t(this.name);
    const option = new StringSelectMenuOptionBuilder()
      .setLabel((this.state ? '🟢 ' : '🔴 ') + name)
      .setValue(this.id)
      .setDescription(t('settings.base_website.description', { name }));
    if (this.emoji) option.setEmoji(this.emoji);
    return option;
  }
}

abstract class EmbedEZBaseSetting extends WebsiteBaseSetting {
  proxies = { EmbedEZ: 'https://embedez.com' };
  is_view = true;
  is_translation = true;
  view_enum = EMBEDEZ_VIEWS;
}

class TroubleshootingSetting extends BaseSetting {
  name = 'settings.troubleshooting.name';
  id = 'troubleshooting';
  description = 'settings.troubleshooting.description';
  emoji = '🛠️';

  async embed(): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle(`${this.emoji} ${t(this.name)}`)
      .setDescription(t('settings.troubleshooting.description'));
    embed.addFields({
      name: t('settings.troubleshooting.ping.name'),
      value: t('settings.troubleshooting.ping.value', {
        latency: String(Math.round(this.bot.ws.ping)),
      }),
      inline: false,
    });
    const perms = ['view_channel', 'send_messages', 'embed_links'];
    if (isThreadChannel(this.ctx.channel.discordObject)) {
      perms.push('send_messages_in_threads');
    }
    if (this.guild.original_message !== 'nothing') perms.push('manage_messages');
    if (this.guild.reply_to_message) perms.push('read_message_history');
    if (this.guild.reply_as_original_author_replica) perms.push('manage_webhooks');
    embed.addFields({
      name: t('settings.troubleshooting.permissions', { channel: mentionOf(this.ctx.channel.discordObject as GuildChannel | ThreadChannel) }),
      value: formatPerms(perms, this.ctx.channel.discordObject as GuildChannel | ThreadChannel, false, true),
      inline: false,
    });

    const options: Array<[string, string | null, boolean, boolean]> = [
      ['channels', this.ctx.channel.mention, this.ctx.channel.enabled(this.guild), false],
      ['webhooks', null, this.guild.webhooks, false],
      ['member', this.ctx.member.mention, replyToMember(this.guild, this.ctx), false],
      ['members', this.ctx.member.mention, this.ctx.member.enabled(this.guild), true],
    ];
    for (const role of this.ctx.roles) {
      options.push(['roles', role.mention, role.enabled(this.guild), true]);
    }
    for (const keyword of this.guild.keywords) {
      options.push(['keywords', keyword, this.guild.keywords_use_allow_list, false]);
    }

    const strOptionsFields = groupJoin(
      options.map(([id, displayValue, state, indented]) =>
        (indented ? '  - ' : '- ') + t(`settings.${id}.state.${boolString(state)}`, {
          element: displayValue,
          details: '',
        }),
      ),
      1024,
    );
    for (let i = 0; i < strOptionsFields.length; i++) {
      embed.addFields({
        name: t('settings.troubleshooting.filters') + (i + 1 > 1 ? ` (${i + 1})` : ''),
        value: strOptionsFields[i],
        inline: false,
      });
    }

    const websites: Record<string, string> = {
      twitter: 'Twitter',
      instagram: 'Instagram',
      tiktok: 'TikTok',
      reddit: 'Reddit',
      threads: 'Threads',
      bluesky: 'Bluesky',
      snapchat: 'Snapchat',
      facebook: 'Facebook',
      pinterest: 'Pinterest',
      pixiv: 'Pixiv',
      twitch: 'Twitch',
      spotify: 'Spotify',
      deviantart: 'DeviantArt',
      newgrounds: 'Newgrounds',
      mastodon: 'Mastodon',
      tumblr: 'Tumblr',
      bilibili: 'BiliBili',
      ifunny: 'iFunny',
      furaffinity: 'Fur Affinity',
      youtube: 'YouTube',
      imageboards: 'Imageboards',
    };
    embed.addFields({
      name: t('settings.troubleshooting.websites'),
      value: Object.entries(websites)
        .map(([key, value]) =>
          '- ' + t(`settings.base_website.state.${boolString(this.guild[key as keyof GuildModel])}`, {
            name: value,
            translation: '',
          }),
        )
        .join('\n'),
      inline: false,
    });
    if (this.guild.custom_websites.length > 0) {
      embed.addFields({
        name: t('settings.troubleshooting.custom_websites'),
        value: this.guild.custom_websites.map((w) => `- \`${w.domain}\``).join('\n'),
        inline: false,
      });
    }
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async items(): Promise<Array<RowItem>> {
    const refreshButton = button(ButtonStyle.Success, t('settings.troubleshooting.refresh')).setCustomId(`refresh`);
    this.view.register('refresh', (i) => this.refreshAction(i));
    const support = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(t('about.support'))
      .setURL(LINKS.support)
      .setEmoji(EMOJI.discord);
    const selectChannel = new ChannelSelectMenuBuilder()
      .setCustomId('channel_select')
      .setChannelTypes(CHANNEL_TYPES)
      .setDefaultChannels(this.ctx.channel.discordObject.id)
      .setMaxValues(1)
      .setPlaceholder(t('settings.channels.select'));
    this.view.register('channel_select', (i) => this.selectChannelAction(i));
    const selectMember = new UserSelectMenuBuilder()
      .setCustomId('member_select')
      .setDefaultUsers(this.ctx.member.discordObject.id)
      .setMaxValues(1)
      .setPlaceholder(t('settings.members.select'));
    this.view.register('member_select', (i) => this.selectMemberAction(i));
    return [
      { builder: refreshButton },
      { builder: support },
      { builder: selectChannel },
      { builder: selectMember },
    ];
  }

  async refreshAction(interaction: Interactive): Promise<void> {
    this.interaction = interaction as MessageComponentInteraction;
    this.ctx.refresh();
    await this.view.refresh(interaction);
  }

  async selectChannelAction(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isChannelSelectMenu()) return;
    const channel = interaction.channels.first();
    if (!channel) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }
    this.ctx.channel.replace(channel as GuildChannel | ThreadChannel);
    await this.view.refresh(interaction);
  }

  async selectMemberAction(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isUserSelectMenu()) return;
    const member = interaction.members.first() as GuildMember | undefined;
    if (!member) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }
    this.ctx.member.replace(member);
    this.ctx.roles.length = 0;
    for (const r of member.roles.cache.values()) {
      this.ctx.roles.push(new FilterElement('roles', this.ctx.member.guildId, r));
    }
    await this.view.refresh(interaction);
  }
}

abstract class GenericFilterSetting extends BaseSetting {
  Model = Filter;
  data_name: string;
  select: (element: FilterElement) => ChannelSelectMenuBuilder | UserSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder;

  element: FilterElement;
  enabled: boolean;
  db_list_column: string;
  use_deny_list: boolean;
  reset_clicked_level = 0;
  perms: string[] = [];

  constructor(
    interaction: ChatInputCommandInteraction | MessageComponentInteraction,
    view: SettingsView,
    ctx: DataElements,
    data_name: string,
    select: (element: FilterElement) => ChannelSelectMenuBuilder | UserSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder,
  ) {
    super(interaction, view, ctx);
    this.data_name = data_name;
    this.select = select;
    this.element = this.ctx[data_name as keyof DataElements] as FilterElement;
    this.enabled = this.element.enabled(this.guild);
    this.db_list_column = `${this.element.table}_use_allow_list`;
    this.use_deny_list = boolString(this.guild[this.db_list_column as keyof GuildModel]) !== 'true';
  }

  async embed(): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder().setTitle(`${this.emoji} ${t(this.name)}`).setDescription(
      t(`settings.${this.id}.content`, {
        bot: this.bot.user?.username ?? '',
        element: this.element.mention,
        state: t(`settings.${this.id}.state.${boolString(this.enabled)}`, {
          element: this.element.mention,
          details: t(`settings.filters.labels.details.on_list.${boolString(this.element.onList(this.guild))}`, {
            list: t(`settings.filters.labels.details.list.${boolString(this.use_deny_list)}`),
          }),
        }),
        default_state: t(`settings.filters.labels.default.${boolString(this.use_deny_list)}`),
        perms: formatPerms(this.perms, this.ctx.channel.discordObject as GuildChannel | ThreadChannel),
      }),
    );
    this.reset_clicked_level -= 1;
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async items(): Promise<Array<RowItem>> {
    const toggleButton = button(
      this.enabled ? ButtonStyle.Primary : ButtonStyle.Secondary,
      t(`settings.filters.button.toggle.${boolString(this.enabled)}`),
    ).setCustomId(`${this.id}_toggle`);
    this.view.register(`${this.id}_toggle`, (i) => this.toggle(i));
    const toggleDefaultButton = button(
      this.use_deny_list ? ButtonStyle.Primary : ButtonStyle.Secondary,
      t(`settings.filters.button.toggle_default.${boolString(this.use_deny_list)}`),
    ).setCustomId(`${this.id}_default`);
    this.view.register(`${this.id}_default`, (i) => this.toggleDefault(i));
    const resetButton = button(
      ButtonStyle.Danger,
      t(`settings.filters.button.reset.${boolString(this.reset_clicked_level > 1)}`),
    ).setCustomId(`${this.id}_reset`);
    this.view.register(`${this.id}_reset`, (i) => this.reset(i));
    const selector = this.select(this.element)
      .setCustomId(`${this.id}_select`)
      .setMaxValues(1)
      .setPlaceholder(t(`settings.${this.id}.select`));
    this.view.register(`${this.id}_select`, (i) => this.selectElement(i));
    return [
      { builder: toggleButton },
      { builder: toggleDefaultButton },
      { builder: resetButton },
      { builder: selector },
    ];
  }

  async toggle(interaction: Interactive): Promise<void> {
    this.enabled = !this.enabled;
    this.element.updateEnabled(this.enabled, this.guild);
    await this.view.refresh(interaction);
  }

  async toggleDefault(interaction: Interactive): Promise<void> {
    this.use_deny_list = !this.use_deny_list;
    this.guild.update({ [this.db_list_column]: !this.use_deny_list } as Partial<GuildModel>);
    this.enabled = this.element.enabled(this.guild);
    await this.view.refresh(interaction);
  }

  async reset(interaction: Interactive): Promise<void> {
    if (this.reset_clicked_level <= 0) {
      this.reset_clicked_level = 2;
      await this.view.refresh(interaction);
      return;
    }
    this.reset_clicked_level = 0;
    this.Model.resetLists(this.element.table, this.ctx.guild.discordObject.id);
    this.element.replace(this.element.discordObject);
    this.enabled = this.element.enabled(this.guild);
    await this.view.refresh(interaction);
  }

  async selectElement(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent()) return;
    await this.selectElementValue(interaction);
  }

  protected async selectElementValue(interaction: MessageComponentInteraction): Promise<void> {
    await this.view.refresh(interaction);
  }

  async option(): Promise<StringSelectMenuOptionBuilder> {
    const prefix = isMissingPerm(this.perms, this.ctx.channel.discordObject as GuildChannel | ThreadChannel) ? '⚠️ ' : '🟢 ';
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(prefix + t(this.name))
      .setValue(this.id)
      .setDescription(t(this.description));
    if (this.emoji) option.setEmoji(this.emoji);
    return option;
  }
}

class ChannelSetting extends GenericFilterSetting {
  name = 'settings.channels.name';
  id = 'channels';
  description = 'settings.channels.description';
  emoji = '#️⃣';

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(
      interaction,
      view,
      ctx,
      'channel',
      (el) =>
        new ChannelSelectMenuBuilder()
          .setChannelTypes(CHANNEL_TYPES)
          .setDefaultChannels(el.discordObject.id),
    );
    this.perms = ['view_channel', 'send_messages', 'embed_links'];
    if (isThreadChannel(this.ctx.channel.discordObject)) {
      this.perms.push('send_messages_in_threads');
    }
  }

  protected async selectElementValue(interaction: MessageComponentInteraction): Promise<void> {
    if (!interaction.isChannelSelectMenu()) return;
    const channel = interaction.channels.first();
    if (!channel) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }
    this.element.replace(channel as GuildChannel | ThreadChannel);
    this.enabled = this.element.enabled(this.guild);
    await this.view.refresh(interaction);
  }
}

class MemberSetting extends GenericFilterSetting {
  name = 'settings.members.name';
  id = 'members';
  description = 'settings.members.description';
  emoji = '👤';

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(
      interaction,
      view,
      ctx,
      'member',
      (el) => new UserSelectMenuBuilder().setDefaultUsers(el.discordObject.id),
    );
  }

  protected async selectElementValue(interaction: MessageComponentInteraction): Promise<void> {
    if (!interaction.isUserSelectMenu()) return;
    const member = interaction.members.first() as GuildMember | undefined;
    if (!member) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }
    this.element.replace(member);
    this.enabled = this.element.enabled(this.guild);
    this.ctx.roles.length = 0;
    for (const r of member.roles.cache.values()) {
      this.ctx.roles.push(new FilterElement('roles', this.ctx.member.guildId, r));
    }
    await this.view.refresh(interaction);
  }
}

class RoleSetting extends GenericFilterSetting {
  name = 'settings.roles.name';
  id = 'roles';
  description = 'settings.roles.description';
  emoji = EMOJI.role;

  use_any_rule: boolean;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(
      interaction,
      view,
      ctx,
      'role',
      (el) => new RoleSelectMenuBuilder().setDefaultRoles(el.discordObject.id),
    );
    this.use_any_rule = this.guild.roles_use_any_rule;
  }

  async embed(): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder().setTitle(`${this.emoji} ${t(this.name)}`).setDescription(
      t(`settings.${this.id}.content`, {
        bot: this.bot.user?.username ?? '',
        element: this.element.mention,
        state: t(`settings.${this.id}.state.${boolString(this.enabled)}`, {
          element: this.element.mention,
          details: t(`settings.filters.labels.details.on_list.${boolString(this.element.onList(this.guild))}`, {
            list: t(`settings.filters.labels.details.list.${boolString(this.use_deny_list)}`),
          }),
        }),
        default_state: t(`settings.filters.labels.default.${boolString(this.use_deny_list)}`),
        rule: t(`settings.${this.id}.rule.${boolString(this.use_any_rule)}`),
        perms: formatPerms(this.perms, this.ctx.channel.discordObject as GuildChannel | ThreadChannel),
      }),
    );
    this.reset_clicked_level -= 1;
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async items(): Promise<Array<RowItem>> {
    const toggleRuleButton = button(
      this.use_any_rule ? ButtonStyle.Primary : ButtonStyle.Secondary,
      t(`settings.${this.id}.button.rule.${boolString(this.use_any_rule)}`),
    ).setCustomId(`${this.id}_rule`);
    this.view.register(`${this.id}_rule`, (i) => this.toggleRule(i));
    const items = await super.items();
    return [items[0], items[1], { builder: toggleRuleButton }, items[2], items[3]];
  }

  async toggle(interaction: Interactive): Promise<void> {
    this.enabled = !this.enabled;
    this.element.updateEnabled(this.enabled, this.guild);
    const idx = this.ctx.roles.findIndex((r) => r.discordObject.id === this.element.discordObject.id);
    if (idx !== -1) {
      this.ctx.roles[idx] = this.element;
    }
    await this.view.refresh(interaction);
  }

  async toggleRule(interaction: Interactive): Promise<void> {
    this.use_any_rule = !this.use_any_rule;
    this.guild.update({ roles_use_any_rule: this.use_any_rule });
    await this.view.refresh(interaction);
  }
}

class KeywordModalHandler {
  constructor(
    private keywordIndex: number | null,
    private setting: KeywordsSetting,
  ) {}

  async onSubmit(interaction: Interactive): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    const values = this.setting.keywords;
    const value = interaction.fields.getTextInputValue('value');

    if (value.length > 50) {
      await interaction.reply({
        content: t('settings.keywords.modal.error.length', { max: 50 }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (values.includes(value) && (this.keywordIndex === null || 0 !== this.keywordIndex)) {
      await interaction.reply({ content: t('settings.keywords.modal.error.exists'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (this.keywordIndex !== null) {
      values[this.keywordIndex] = value;
    } else {
      values.push(value);
      this.setting.selected_index = values.length - 1;
    }
    this.setting.guild.update({ keywords: values });
    await this.setting.view.refresh(interaction);
  }
}

class KeywordsSetting extends BaseSetting {
  name = 'settings.keywords.name';
  id = 'keywords';
  description = 'settings.keywords.description';
  emoji = '🔤';

  selected_index: number | null = null;
  use_allow_list: boolean;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(interaction, view, ctx);
    this.selected_index = null;
    this.use_allow_list = this.guild.keywords_use_allow_list;
  }

  get keywords(): string[] {
    return this.guild.keywords;
  }

  async embed(): Promise<EmbedBuilder> {
    const keywordsStr = this.keywords.length
      ? this.keywords
          .map((keyword, index) => (index === this.selected_index ? `- **${keyword}**` : `- ${keyword}`))
          .join('\n')
      : '*' + t('settings.keywords.empty') + '*';
    const embed = new EmbedBuilder()
      .setTitle(`${this.emoji} ${t(this.name)}`)
      .setDescription(t(`settings.keywords.content.${boolString(this.use_allow_list)}`, { keywords: keywordsStr }));
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async items(): Promise<Array<RowItem>> {
    const options = this.keywords.length
      ? this.keywords.map((keyword, index) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(keyword)
            .setValue(String(index))
            .setDefault(index === this.selected_index),
        )
      : [new StringSelectMenuOptionBuilder().setLabel(t('settings.keywords.empty')).setValue('0').setDefault(true)];

    const select = new StringSelectMenuBuilder()
      .setCustomId('select_keyword')
      .setPlaceholder(t('settings.keywords.button.placeholder'))
      .setMaxValues(1)
      .setOptions(options.filter(Boolean))
      .setDisabled(this.keywords.length === 0);
    this.view.register('select_keyword', (i) => this.selectKeyword(i));

    let addButton: ButtonBuilder;
    if (this.keywords.length >= 25) {
      addButton = button(ButtonStyle.Primary, t('settings.keywords.button.max'), true).setCustomId('add_keyword');
    } else {
      addButton = button(ButtonStyle.Primary, t('settings.keywords.button.add')).setCustomId('add_keyword');
      this.view.register('add_keyword', (i) => this.cuKeyword(i));
    }
    const editButton = button(ButtonStyle.Secondary, t('settings.keywords.button.edit'), this.selected_index === null).setCustomId(
      'edit_keyword',
    );
    this.view.register('edit_keyword', (i) => this.cuKeyword(i));
    const deleteButton = button(ButtonStyle.Danger, t('settings.keywords.button.delete'), this.selected_index === null).setCustomId(
      'delete_keyword',
    );
    this.view.register('delete_keyword', (i) => this.deleteKeyword(i));
    const toggleModeButton = button(
      this.use_allow_list ? ButtonStyle.Primary : ButtonStyle.Secondary,
      t(`settings.keywords.button.toggle_mode.${boolString(this.use_allow_list)}`),
    ).setCustomId(`${this.id}_default`);
    this.view.register(`${this.id}_default`, (i) => this.toggleMode(i));

    return [
      { builder: select },
      { builder: addButton },
      { builder: editButton },
      { builder: deleteButton },
      { builder: toggleModeButton },
    ];
  }

  async selectKeyword(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isStringSelectMenu()) return;
    this.selected_index = parseInt(interaction.values[0], 10);
    await this.view.refresh(interaction);
  }

  async cuKeyword(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isButton()) return;
    await this.view.resetTimeout(interaction);
    const index = interaction.customId === 'edit_keyword' ? this.selected_index : null;
    const keywordIndex =
      interaction.customId === 'edit_keyword' && this.selected_index !== null ? this.selected_index : null;
    const values = this.keywords;
    const handler = new KeywordModalHandler(index, this);
    this.view.register('keyword_modal', (i) => handler.onSubmit(i));
    const valueInput = new TextInputBuilder()
      .setCustomId('value')
      .setLabel(t('settings.keywords.modal.value.label'))
      .setPlaceholder(t('settings.keywords.modal.value.placeholder'))
      .setMinLength(1)
      .setMaxLength(50)
      .setStyle(TextInputStyle.Short);
    if (keywordIndex !== null) valueInput.setValue(values[keywordIndex]);
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('keyword_modal')
        .setTitle(t('settings.keywords.modal.title'))
        .addComponents(new ActionRowBuilder<any>().addComponents(valueInput)),
    );
  }

  async deleteKeyword(interaction: Interactive): Promise<void> {
    if (this.selected_index === null) return;
    this.keywords.splice(this.selected_index, 1);
    this.guild.update({ keywords: this.keywords });
    this.selected_index = null;
    await this.view.refresh(interaction);
  }

  async toggleMode(interaction: Interactive): Promise<void> {
    this.use_allow_list = !this.use_allow_list;
    this.guild.update({ keywords_use_allow_list: this.use_allow_list });
    await this.view.refresh(interaction);
  }
}

export class OriginalMessageBehaviorSetting extends BaseSetting {
  name = 'settings.original_message.name';
  id = 'original_message';
  description = 'settings.original_message.description';
  emoji = '💬';

  state: OriginalMessage;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(interaction, view, ctx);
    this.state = this.guild.original_message;
  }

  async embed(): Promise<EmbedBuilder> {
    const optionTrPath = `settings.original_message.option.${this.state}`;
    const embed = new EmbedBuilder().setTitle(`${this.emoji} ${t(this.name)}`).setDescription(
      t('settings.original_message.content', {
        state: t(optionTrPath + '.emoji') + ' ' + t(optionTrPath + '.label'),
        channel: this.ctx.channel.mention,
        perms: formatPerms(
          this.state !== 'nothing' ? ['manage_messages'] : [],
          this.ctx.channel.discordObject as GuildChannel | ThreadChannel,
        ),
      }),
    );
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async option(): Promise<StringSelectMenuOptionBuilder> {
    const prefix =
      this.state !== 'nothing' && isMissingPerm(['manage_messages'], this.ctx.channel.discordObject as GuildChannel | ThreadChannel)
        ? '⚠️ '
        : '';
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(prefix + t(this.name))
      .setValue(this.id)
      .setDescription(t(this.description));
    if (this.emoji) option.setEmoji(this.emoji);
    return option;
  }

  async items(): Promise<Array<RowItem>> {
    const select = new StringSelectMenuBuilder()
      .setCustomId('original_message_select')
      .setMaxValues(1)
      .addOptions(
        ORIGINAL_MESSAGES.map((option) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(t(`settings.original_message.option.${option}.label`))
            .setEmoji(t(`settings.original_message.option.${option}.emoji`))
            .setValue(option)
            .setDefault(option === this.state),
        ),
      );
    this.view.register('original_message_select', (i) => this.action(i));
    return [{ builder: select }];
  }

  async action(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isStringSelectMenu()) return;
    this.state = interaction.values[0] as OriginalMessage;
    this.guild.update({ original_message: this.state });
    await this.view.refresh(interaction);
  }
}

class ReplyMethodSetting extends BaseSetting {
  name = 'settings.reply_method.name';
  id = 'reply_method';
  description = 'settings.reply_method.description';
  emoji = EMOJI.reply;

  reply_as_original_author_replica: boolean;
  reply_to_message: boolean;
  reply_silently: boolean;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(interaction, view, ctx);
    this.reply_as_original_author_replica = boolString(this.guild.reply_as_original_author_replica) === 'true';
    this.reply_to_message = boolString(this.guild.reply_to_message) === 'true' && !this.reply_as_original_author_replica;
    this.reply_silently = boolString(this.guild.reply_silently) === 'true';
  }

  async embed(): Promise<EmbedBuilder> {
    const perms = ['view_channel', 'send_messages', 'embed_links'];
    if (isThreadChannel(this.ctx.channel.discordObject)) {
      perms.push('send_messages_in_threads');
    }
    if (this.reply_to_message) perms.push('read_message_history');
    if (this.reply_as_original_author_replica) perms.push('manage_webhooks');
    const embed = new EmbedBuilder().setTitle(`${this.emoji} ${t(this.name)}`).setDescription(
      t('settings.reply_method.content', {
        state: t(`settings.reply_method.reply.state.${boolString(this.reply_to_message)}`, { emoji: this.emoji }),
        silent: t(`settings.reply_method.silent.state.${boolString(this.reply_silently)}`),
        replica: t(
          `settings.reply_method.original_author_replica.state.${boolString(this.reply_as_original_author_replica)}`,
          { bot: this.bot.user?.username ?? '' },
        ),
        perms: formatPerms(perms, this.ctx.channel.discordObject as GuildChannel | ThreadChannel),
      }),
    );
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async option(): Promise<StringSelectMenuOptionBuilder> {
    const hasMissingPerms =
      (this.reply_to_message && isMissingPerm(['read_message_history'], this.ctx.channel.discordObject as GuildChannel | ThreadChannel)) ||
      (this.reply_as_original_author_replica &&
        isMissingPerm(['manage_webhooks'], this.ctx.channel.discordObject as GuildChannel | ThreadChannel));
    const option = new StringSelectMenuOptionBuilder()
      .setLabel((hasMissingPerms ? '⚠️ ' : '') + t(this.name))
      .setValue(this.id)
      .setDescription(t(this.description));
    if (this.emoji) option.setEmoji(this.emoji);
    return option;
  }

  async items(): Promise<Array<RowItem>> {
    const replyButton = button(
      this.reply_to_message ? ButtonStyle.Primary : ButtonStyle.Secondary,
      t(`settings.reply_method.reply.button.${boolString(this.reply_to_message)}`),
      this.reply_as_original_author_replica,
    ).setCustomId(this.id);
    this.view.register(this.id, (i) => this.toggleReplyToMessage(i));
    const silentButton = button(
      this.reply_silently ? ButtonStyle.Secondary : ButtonStyle.Primary,
      t(`settings.reply_method.silent.button.${boolString(this.reply_silently)}`),
    ).setCustomId('reply_silently');
    this.view.register('reply_silently', (i) => this.toggleReplySilently(i));
    const replicaButton = button(
      this.reply_as_original_author_replica ? ButtonStyle.Primary : ButtonStyle.Secondary,
      t(`settings.reply_method.original_author_replica.button.${boolString(this.reply_as_original_author_replica)}`, {
        bot: this.bot.user?.username ?? '',
      }),
    ).setCustomId('reply_as_original_author_replica');
    this.view.register('reply_as_original_author_replica', (i) => this.toggleReplyAsOriginalAuthorReplica(i));
    return [
      { builder: replyButton },
      { builder: silentButton },
      { builder: replicaButton },
    ];
  }

  async toggleReplyToMessage(interaction: Interactive): Promise<void> {
    if (this.reply_as_original_author_replica) return;
    this.reply_to_message = !this.reply_to_message;
    this.guild.update({ reply_to_message: this.reply_to_message });
    await this.view.refresh(interaction);
  }

  async toggleReplySilently(interaction: Interactive): Promise<void> {
    this.reply_silently = !this.reply_silently;
    this.guild.update({ reply_silently: this.reply_silently });
    await this.view.refresh(interaction);
  }

  async toggleReplyAsOriginalAuthorReplica(interaction: Interactive): Promise<void> {
    this.reply_as_original_author_replica = !this.reply_as_original_author_replica;
    if (this.reply_as_original_author_replica) {
      this.reply_to_message = false;
    }
    this.guild.update({
      reply_as_original_author_replica: this.reply_as_original_author_replica,
      reply_to_message: this.reply_to_message,
    });
    await this.view.refresh(interaction);
  }
}

class WebhooksSetting extends BaseSetting {
  name = 'settings.webhooks.name';
  id = 'webhooks';
  description = 'settings.webhooks.description';
  emoji = EMOJI.webhooks;

  state: boolean;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(interaction, view, ctx);
    this.state = boolString(this.guild.webhooks) === 'true';
  }

  async embed(): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle(`${this.emoji} ${t(this.name)}`)
      .setDescription(t('settings.webhooks.content', { state: t(`settings.webhooks.state.${boolString(this.state)}`) }));
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async option(): Promise<StringSelectMenuOptionBuilder> {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel((this.state ? '🟢 ' : '🔴 ') + t(this.name))
      .setValue(this.id)
      .setDescription(t(this.description));
    if (this.emoji) option.setEmoji(this.emoji);
    return option;
  }

  async items(): Promise<Array<RowItem>> {
    const item = button(
      this.state ? ButtonStyle.Primary : ButtonStyle.Secondary,
      t(`settings.webhooks.button.${boolString(this.state)}`),
    ).setCustomId(this.id);
    this.view.register(this.id, (i) => this.action(i));
    return [{ builder: item }];
  }

  async action(interaction: Interactive): Promise<void> {
    this.state = !this.state;
    this.guild.update({ webhooks: this.state });
    await this.view.refresh(interaction);
  }
}

export class TwitterSetting extends WebsiteBaseSetting {
  id = 'twitter';
  name = 'Twitter';
  emoji = EMOJI.twitter;
  proxies = { FxTwitter: 'https://github.com/FxEmbed/FxEmbed' };
  is_translation = true;
  is_view = true;
  view_enum = FX_EMBED_VIEWS;
}

class InstagramSetting extends WebsiteBaseSetting {
  id = 'instagram';
  name = 'Instagram';
  emoji = EMOJI.instagram;
  proxies = { OGInstagram: 'https://github.com/seirenkr/OGInstagram' };
  is_view = true;
  view_enum = INSTAGRAM_VIEWS;
}

class TikTokSetting extends WebsiteBaseSetting {
  id = 'tiktok';
  name = 'TikTok';
  emoji = EMOJI.tiktok;
  proxies = { fxTikTok: 'https://github.com/okdargy/fxTikTok' };
  is_view = true;
  view_enum = TIKTOK_VIEWS;
}

class RedditSetting extends WebsiteBaseSetting {
  id = 'reddit';
  name = 'Reddit';
  emoji = EMOJI.reddit;
  proxies = { vxreddit: 'https://github.com/dylanpdx/vxReddit' };
}

class ThreadsSetting extends WebsiteBaseSetting {
  id = 'threads';
  name = 'Threads';
  emoji = EMOJI.threads;
  proxies = { FixThreads: 'https://github.com/tonghongte/fixthreads' };
}

class BlueskySetting extends WebsiteBaseSetting {
  id = 'bluesky';
  name = 'Bluesky';
  emoji = EMOJI.bluesky;
  proxies = { FxBluesky: 'https://github.com/FxEmbed/FxEmbed' };
  is_view = true;
  view_enum = FX_EMBED_VIEWS;
}

class SnapchatSetting extends EmbedEZBaseSetting {
  id = 'snapchat';
  name = 'Snapchat';
  emoji = EMOJI.snapchat;
}

class FacebookSetting extends WebsiteBaseSetting {
  id = 'facebook';
  name = 'Facebook';
  emoji = EMOJI.facebook;
  proxies = { facebed: 'https://github.com/seriaati/facebed' };
}

class PixivSetting extends WebsiteBaseSetting {
  id = 'pixiv';
  name = 'Pixiv';
  emoji = EMOJI.pixiv;
  proxies = { phixiv: 'https://github.com/thelaao/phixiv' };
}

class TwitchSetting extends WebsiteBaseSetting {
  id = 'twitch';
  name = 'Twitch';
  emoji = EMOJI.twitch;
  proxies = { fxtwitch: 'https://github.com/seriaati/fxtwitch' };
}

class SpotifySetting extends WebsiteBaseSetting {
  id = 'spotify';
  name = 'Spotify';
  emoji = EMOJI.spotify;
  proxies = { fxspotify: 'https://github.com/dotconnexion/fxspotify' };
}

class DeviantArtSetting extends WebsiteBaseSetting {
  id = 'deviantart';
  name = 'DeviantArt';
  emoji = EMOJI.deviantart;
  proxies = { fixDeviantArt: 'https://github.com/Tschrock/fixdeviantart' };
}

class NewgroundsSetting extends WebsiteBaseSetting {
  id = 'newgrounds';
  name = 'Newgrounds';
  emoji = EMOJI.newgrounds;
  proxies = { FixNewgrounds: 'https://github.com/SauceyRed/fix-newgrounds' };
}

class MastodonSetting extends WebsiteBaseSetting {
  id = 'mastodon';
  name = 'Mastodon';
  emoji = EMOJI.mastodon;
  proxies = { FxMastodon: 'https://github.com/Someguy123/fxmastodon' };
}

class TumblrSetting extends WebsiteBaseSetting {
  id = 'tumblr';
  name = 'Tumblr';
  emoji = EMOJI.tumblr;
  proxies = { fxtumblr: 'https://github.com/knuxify/fxtumblr' };
}

class BilibiliSetting extends WebsiteBaseSetting {
  id = 'bilibili';
  name = 'BiliBili';
  emoji = EMOJI.bilibili;
  proxies = { BiliFix: 'https://www.vxbilibili.com/' };
}

class IFunnySetting extends EmbedEZBaseSetting {
  id = 'ifunny';
  name = 'iFunny';
  emoji = EMOJI.ifunny;
}

class FurAffinitySetting extends WebsiteBaseSetting {
  id = 'furaffinity';
  name = 'Fur Affinity';
  emoji = EMOJI.furaffinity;
  proxies = { xfuraffinity: 'https://github.com/FirraWoof/xfuraffinity' };
}

class YouTubeSetting extends WebsiteBaseSetting {
  id = 'youtube';
  name = 'YouTube';
  emoji = EMOJI.youtube;
  proxies = { Koutube: 'https://github.com/iGerman00/koutube' };
}

class ImgurSetting extends EmbedEZBaseSetting {
  id = 'imgur';
  name = 'Imgur';
  emoji = EMOJI.imgur;
}

class WeiboSetting extends EmbedEZBaseSetting {
  id = 'weibo';
  name = 'Weibo';
  emoji = EMOJI.weibo;
}

class ImageboardsSetting extends EmbedEZBaseSetting {
  id = 'imageboards';
  name = 'settings.imageboards';
  emoji = EMOJI.imageboards;
  is_translation = false;
}

class PinterestSetting extends EmbedEZBaseSetting {
  id = 'pinterest';
  name = 'Pinterest';
  emoji = EMOJI.pinterest;
}

class CustomWebsiteModalHandler {
  constructor(
    private website: CustomWebsite | null,
    private setting: CustomWebsitesSetting,
  ) {}

  async onSubmit(interaction: Interactive): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    const cleanDomain = (domain: string): string => {
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        domain = domain.split('://', 1)[1];
      }
      if (domain.startsWith('www.')) {
        domain = domain.slice(4);
      }
      if (domain.endsWith('/')) {
        domain = domain.slice(0, -1);
      }
      return domain;
    };

    let name = interaction.fields.getTextInputValue('name');
    let domain = interaction.fields.getTextInputValue('domain');
    let fixDomain = interaction.fields.getTextInputValue('fix_domain');

    domain = cleanDomain(domain);
    fixDomain = cleanDomain(fixDomain);

    if (!domain || !fixDomain) {
      await interaction.reply({ content: t('settings.custom_websites.modal.error.length'), flags: MessageFlags.Ephemeral });
      return;
    }

    const existing = CustomWebsite.findAllByGuild(interaction.guildId!).find((w) => w.domain === domain);
    if (existing && (!this.website || existing.id !== this.website.id)) {
      await interaction.reply({ content: t('settings.custom_websites.modal.error.exists'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (name.length > 36) {
      await interaction.reply({ content: t('settings.custom_websites.modal.error.length_name', { max: 36 }), flags: MessageFlags.Ephemeral });
      return;
    }

    if (domain.length > 61) {
      await interaction.reply({ content: t('settings.custom_websites.modal.error.length_domain', { max: 61 }), flags: MessageFlags.Ephemeral });
      return;
    }

    if (this.website) {
      this.website.update({ name, domain, fix_domain: fixDomain });
    } else {
      this.website = CustomWebsite.create(interaction.guildId!, { name, domain, fix_domain: fixDomain });
    }
    this.setting.selected = this.website;
    await this.setting.view.refresh(interaction);
  }
}

class CustomWebsitesSetting extends BaseSetting {
  name = 'settings.custom_websites.name';
  id = 'custom_websites';
  description = 'settings.custom_websites.description';
  emoji = '🌐';

  selected: CustomWebsite | null = null;

  get websites(): CustomWebsite[] {
    return this.guild.custom_websites.slice(0, 25);
  }

  async embed(): Promise<EmbedBuilder> {
    const websiteList = this.websites
      .map((website) =>
        t(
          website.id === this.selected?.id ? 'settings.custom_websites.selected_website' : 'settings.custom_websites.website',
          {
            name: website.name,
            domain: website.domain,
            fix_domain: website.fix_domain,
          },
        ),
      )
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`${this.emoji} ${t(this.name)}`)
      .setDescription(t('settings.custom_websites.content') + (websiteList ? t('settings.custom_websites.list') + websiteList : ''));
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async items(): Promise<Array<RowItem>> {
    const websites = this.websites;
    const options = websites.length
      ? websites.map((website) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${website.name} (${website.domain})`)
            .setValue(website.domain)
            .setDefault(website.id === this.selected?.id),
        )
      : [new StringSelectMenuOptionBuilder().setLabel(t('settings.custom_websites.empty')).setValue('0').setDefault(true)];

    const selector = new StringSelectMenuBuilder()
      .setCustomId('custom_website_select')
      .setPlaceholder(t('settings.custom_websites.placeholder'))
      .setMaxValues(1)
      .setOptions(options)
      .setDisabled(websites.length === 0);
    this.view.register('custom_website_select', (i) => this.selectAction(i));

    let addButton: ButtonBuilder;
    if (websites.length >= 25) {
      addButton = button(ButtonStyle.Primary, t('settings.custom_websites.button.max'), true).setCustomId('add_website');
    } else {
      addButton = button(ButtonStyle.Primary, t('settings.custom_websites.button.add')).setCustomId('add_website');
      this.view.register('add_website', (i) => this.action(i));
    }
    const editButton = button(ButtonStyle.Secondary, t('settings.custom_websites.button.edit'), this.selected === null).setCustomId(
      'edit_website',
    );
    this.view.register('edit_website', (i) => this.action(i));
    const deleteButton = button(ButtonStyle.Danger, t('settings.custom_websites.button.delete'), this.selected === null).setCustomId(
      'delete_website',
    );
    this.view.register('delete_website', (i) => this.deleteAction(i));
    return [
      { builder: selector },
      { builder: addButton },
      { builder: editButton },
      { builder: deleteButton },
    ];
  }

  async action(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isButton()) return;
    await this.view.resetTimeout(interaction);
    const website = interaction.customId === 'edit_website' ? this.selected : null;
    this.view.register('custom_website_modal', (i) => new CustomWebsiteModalHandler(website, this).onSubmit(i));
    const name = website?.name;
    const domain = website?.domain;
    const fixDomain = website?.fix_domain;
    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel(t('settings.custom_websites.modal.name.label'))
      .setPlaceholder(t('settings.custom_websites.modal.name.placeholder'))
      .setMaxLength(36)
      .setStyle(TextInputStyle.Short);
    const domainInput = new TextInputBuilder()
      .setCustomId('domain')
      .setLabel(t('settings.custom_websites.modal.domain.label'))
      .setPlaceholder(t('settings.custom_websites.modal.domain.placeholder'))
      .setMaxLength(61)
      .setStyle(TextInputStyle.Short);
    const fixDomainInput = new TextInputBuilder()
      .setCustomId('fix_domain')
      .setLabel(t('settings.custom_websites.modal.fix_domain.label'))
      .setPlaceholder(t('settings.custom_websites.modal.fix_domain.placeholder'))
      .setMaxLength(61)
      .setStyle(TextInputStyle.Short);
    if (name !== undefined) nameInput.setValue(name);
    if (domain !== undefined) domainInput.setValue(domain);
    if (fixDomain !== undefined) fixDomainInput.setValue(fixDomain);
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('custom_website_modal')
        .setTitle(t('settings.custom_websites.modal.title'))
        .addComponents(
          new ActionRowBuilder<any>().addComponents(nameInput),
          new ActionRowBuilder<any>().addComponents(domainInput),
          new ActionRowBuilder<any>().addComponents(fixDomainInput),
        ),
    );
  }

  async deleteAction(interaction: Interactive): Promise<void> {
    if (!this.selected) return;
    this.selected.delete();
    this.selected = null;
    await this.view.refresh(interaction);
  }

  async selectAction(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isStringSelectMenu()) return;
    this.selected = this.websites.find((w) => w.domain === interaction.values[0]) ?? null;
    await this.view.refresh(interaction);
  }

  async option(): Promise<StringSelectMenuOptionBuilder> {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel((this.websites.length ? '🟢 ' : '🔴 ') + t(this.name))
      .setValue(this.id)
      .setDescription(t(this.description));
    if (this.emoji) option.setEmoji(this.emoji);
    return option;
  }
}

class WebsiteSettings extends BaseSetting {
  name = 'settings.websites.name';
  id = 'websites';
  description = 'settings.websites.description';
  emoji = '🌐';

  settings: Record<string, BaseSetting>;
  selected_id: string | null = null;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction, view: SettingsView, ctx: DataElements) {
    super(interaction, view, ctx);
    const all: Array<BaseSetting> = [
      new CustomWebsitesSetting(interaction, view, ctx),
      new TwitterSetting(interaction, view, ctx),
      new InstagramSetting(interaction, view, ctx),
      new TikTokSetting(interaction, view, ctx),
      new RedditSetting(interaction, view, ctx),
      new ThreadsSetting(interaction, view, ctx),
      new BlueskySetting(interaction, view, ctx),
      new SnapchatSetting(interaction, view, ctx),
      new FacebookSetting(interaction, view, ctx),
      new PinterestSetting(interaction, view, ctx),
      new PixivSetting(interaction, view, ctx),
      new TwitchSetting(interaction, view, ctx),
      new SpotifySetting(interaction, view, ctx),
      new DeviantArtSetting(interaction, view, ctx),
      new NewgroundsSetting(interaction, view, ctx),
      new MastodonSetting(interaction, view, ctx),
      new TumblrSetting(interaction, view, ctx),
      new BilibiliSetting(interaction, view, ctx),
      new WeiboSetting(interaction, view, ctx),
      new ImgurSetting(interaction, view, ctx),
      new IFunnySetting(interaction, view, ctx),
      new YouTubeSetting(interaction, view, ctx),
      new FurAffinitySetting(interaction, view, ctx),
      new ImageboardsSetting(interaction, view, ctx),
    ];
    this.settings = Object.fromEntries(all.map((s) => [s.id, s]));
    this.selected_id = null;
  }

  async embed(): Promise<EmbedBuilder> {
    if (this.selected_id !== null && this.settings[this.selected_id]) {
      return this.settings[this.selected_id].embed();
    }
    const embed = new EmbedBuilder()
      .setTitle(`${this.emoji} ${t(this.name)}`)
      .setDescription(t('settings.websites.content'));
    setEmbedFooter(this.bot, embed);
    return embed;
  }

  async items(): Promise<Array<RowItem>> {
    const items: Array<RowItem> = [];
    if (this.selected_id !== null && this.settings[this.selected_id]) {
      items.push(...(await this.settings[this.selected_id].items()));
    }
    const options: Array<StringSelectMenuOptionBuilder> = [];
    for (const [settingId, setting] of Object.entries(this.settings)) {
      const option = await setting.option();
      options.push(option);
    }
    const parameterSelection = new StringSelectMenuBuilder()
      .setCustomId('website_parameter')
      .setMaxValues(1)
      .setPlaceholder(t('settings.websites.placeholder'))
      .addOptions(options);
    this.view.register('website_parameter', (i) => this.action(i));
    items.push({ builder: parameterSelection, row: 3 });
    return items;
  }

  async action(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isStringSelectMenu()) return;
    this.selected_id = interaction.values[0];
    await this.view.refresh(interaction);
  }
}

export class SettingsView {
  bot: Client;
  ctx: DataElements;
  embed: EmbedBuilder | null = null;
  settings: Record<string, BaseSetting>;
  selected_id: string | null = null;
  key: string;

  callbacks = new Map<string, Callback>();
  private deleteTimer: NodeJS.Timeout | null = null;
  private isActive = false;

  constructor(interaction: ChatInputCommandInteraction | MessageComponentInteraction) {
    if (!interaction.guild) throw new Error('settings view requires a guild');
    this.bot = interaction.client;
    this.key = `${interaction.guild.id}:${interaction.user.id}`;
    this.ctx = new DataElements(interaction as ChatInputCommandInteraction);
    const all: Array<BaseSetting> = [
      new TroubleshootingSetting(interaction, this, this.ctx),
      new ChannelSetting(interaction, this, this.ctx),
      new MemberSetting(interaction, this, this.ctx),
      new RoleSetting(interaction, this, this.ctx),
      new KeywordsSetting(interaction, this, this.ctx),
      new WebsiteSettings(interaction, this, this.ctx),
      new OriginalMessageBehaviorSetting(interaction, this, this.ctx),
      new ReplyMethodSetting(interaction, this, this.ctx),
      new WebhooksSetting(interaction, this, this.ctx),
    ];
    this.settings = Object.fromEntries(all.map((s) => [s.id, s]));
    this.selected_id = null;
  }

  register(customId: string, callback: Callback): void {
    this.callbacks.set(customId, callback);
  }

  async build(): Promise<void> {
    await this.ctx.guild.discordObject.members
      .fetch({ user: this.bot.user!.id, force: true })
      .catch(() => {});
    this.callbacks.clear();
    const items: Array<RowItem> = [];
    if (this.selected_id !== null && this.settings[this.selected_id]) {
      items.push(...(await this.settings[this.selected_id].items()));
    }
    const options: Array<StringSelectMenuOptionBuilder> = [];
    for (const [settingId, setting] of Object.entries(this.settings)) {
      const option = await setting.option();
      options.push(option);
    }
    const parameterSelection = new StringSelectMenuBuilder()
      .setCustomId('select_parameter')
      .setMaxValues(1)
      .setPlaceholder(t('settings.placeholder'))
      .addOptions(options);
    this.register('select_parameter', (i) => this.selectParameter(i));
    items.push({ builder: parameterSelection, row: 4 });

    const defaultEmbed = new EmbedBuilder().setTitle(t('settings.title')).setDescription(t('settings.description'));
    setEmbedFooter(this.bot, defaultEmbed);
    this.embed =
      this.selected_id !== null && this.settings[this.selected_id]
        ? await this.settings[this.selected_id].embed()
        : defaultEmbed;
    this.rows = packRows(items);
  }

  rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  async selectParameter(interaction: Interactive): Promise<void> {
    if (!interaction.isMessageComponent() || !interaction.isStringSelectMenu()) return;
    this.selected_id = interaction.values[0];
    await this.refresh(interaction);
  }

  async refresh(interaction: ChatInputCommandInteraction | Interactive): Promise<void> {
    const isInitial = !interaction.isMessageComponent() && !interaction.isModalSubmit();
    if (isInitial) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    let payload: { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } | null = null;
    try {
      await this.build();
      payload = { embeds: [this.embed!], components: this.rows };
    } catch (e) {
      console.error('settings view build error:', e);
    }
    try {
      if (interaction.isModalSubmit()) {
        if (interaction.isFromMessage() && payload) {
          await interaction.update(payload);
        }
      } else if (interaction.isMessageComponent()) {
        if (payload) {
          await interaction.update(payload);
        } else {
          await interaction.deferUpdate();
        }
      } else {
        this.isActive = true;
        activeViews.set(this.key, this);
        await interaction.editReply(payload ?? { content: t('settings.error') });
      }
    } catch (e) {
      console.error('settings view send error:', e);
      if (interaction.isMessageComponent()) {
        await interaction.deferUpdate().catch(() => {});
      }
    }
    this.resetTimeout(interaction);
  }

  async send(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.refresh(interaction);
  }

  resetTimeout(interaction: ChatInputCommandInteraction | Interactive): void {
    if (this.deleteTimer) clearTimeout(this.deleteTimer);
    const view = this;
    this.deleteTimer = setTimeout(() => {
      void interaction.deleteReply().catch(() => {});
      if (view.isActive) activeViews.delete(view.key);
    }, 180_000);
  }
}

const activeViews = new Map<string, SettingsView>();

function viewKey(interaction: ChatInputCommandInteraction | Interactive): string {
  return `${interaction.guild?.id ?? ''}:${interaction.user.id}`;
}

export async function handleSettingsInteraction(interaction: Interactive): Promise<void> {
  const view = activeViews.get(viewKey(interaction));
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
    console.error('settings view error:', e);
    if (interaction.isMessageComponent()) await interaction.deferUpdate().catch(() => {});
  }
}

function replyToMember(guild: GuildModel, ctx: DataElements): boolean {
  if (!ctx.member.enabled(guild)) return false;
  const rule = guild.roles_use_any_rule ? (values: boolean[]) => values.some(Boolean) : (values: boolean[]) => values.every(Boolean);
  return rule(ctx.roles.map((r) => r.enabled(guild)));
}

function groupJoin(strings: string[], maxGroupSize: number, sep = '\n'): string[] {
  const groups: string[] = [];
  for (const s of strings) {
    if (groups.length === 0) {
      groups.push(s);
    } else if (groups[groups.length - 1].length + sep.length + s.length <= maxGroupSize) {
      groups[groups.length - 1] += sep + s;
    } else {
      groups.push(s);
    }
  }
  return groups;
}
