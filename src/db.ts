import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { FixerStrategy } from './fixers';

const DB_DIR = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : process.cwd();
const DB_FILE = process.env.DB_PATH ?? path.join(DB_DIR, 'data.sqlite');
fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

initDb();

export type OriginalMessage = 'nothing' | 'remove_embeds' | 'delete';
export type FxEmbedView = 'normal' | 'gallery' | 'text_only' | 'direct_media';
export type InstagramView = 'normal' | 'direct_media' | 'gallery';
export type TiktokView = 'normal' | 'gallery' | 'direct_media';
export type EmbedEzView = 'normal' | 'direct_media';

export type FilterTable = 'text_channels' | 'members' | 'roles';

export interface GuildRow {
  id: string;
  keywords: string;
  fixer_strategy: string;
  keywords_use_allow_list: number;
  text_channels_use_allow_list: number;
  members_use_allow_list: number;
  roles_use_allow_list: number;
  roles_use_any_rule: number;
  lang: string | null;
  original_message: string;
  reply_to_message: number;
  reply_silently: number;
  reply_as_original_author_replica: number;
  webhooks: number;
  twitter: number;
  twitter_tr: number;
  twitter_view: string;
  instagram: number;
  instagram_view: string;
  instagram_tr: number;
  tiktok: number;
  tiktok_view: string;
  reddit: number;
  threads: number;
  bluesky: number;
  bluesky_view: string;
  pixiv: number;
  ifunny: number;
  ifunny_view: string;
  ifunny_tr: number;
  furaffinity: number;
  youtube: number;
  mastodon: number;
  deviantart: number;
  tumblr: number;
  facebook: number;
  bilibili: number;
  twitch: number;
  spotify: number;
  snapchat: number;
  snapchat_view: string;
  snapchat_tr: number;
  imgur: number;
  imgur_view: string;
  imgur_tr: number;
  weibo: number;
  weibo_view: string;
  weibo_tr: number;
  imageboards: number;
  imageboards_view: string;
  pinterest: number;
  pinterest_view: string;
  pinterest_tr: number;
  newgrounds: number;
}

function updateRow(
  table: string,
  where: Record<string, unknown>,
  fields: Record<string, unknown>,
  toDb: (key: string, value: unknown) => [string, unknown] | null,
): boolean {
  const set: string[] = [];
  const params: Record<string, unknown> = { ...where };
  for (const [key, value] of Object.entries(fields)) {
    const out = toDb(key, value);
    if (out) {
      set.push(`${out[0]} = @${out[0]}`);
      params[out[0]] = out[1];
    }
  }
  if (set.length === 0) return false;
  const whereSql = Object.keys(where)
    .map((k) => `${k} = @${k}`)
    .join(' AND ');
  db.prepare(`UPDATE ${table} SET ${set.join(', ')} WHERE ${whereSql}`).run(params);
  return true;
}

export class Guild {
  id: string;
  keywords: string[];
  keywords_use_allow_list: boolean;
  text_channels_use_allow_list: boolean;
  members_use_allow_list: boolean;
  roles_use_allow_list: boolean;
  roles_use_any_rule: boolean;
  lang: string | null;
  original_message: OriginalMessage;
  reply_to_message: boolean;
  reply_silently: boolean;
  reply_as_original_author_replica: boolean;
  webhooks: boolean;
  twitter: boolean;
  twitter_tr: boolean;
  twitter_view: FxEmbedView;
  instagram: boolean;
  instagram_view: InstagramView;
  instagram_tr: boolean;
  tiktok: boolean;
  tiktok_view: TiktokView;
  reddit: boolean;
  threads: boolean;
  bluesky: boolean;
  bluesky_view: FxEmbedView;
  pixiv: boolean;
  ifunny: boolean;
  ifunny_view: EmbedEzView;
  ifunny_tr: boolean;
  furaffinity: boolean;
  youtube: boolean;
  mastodon: boolean;
  deviantart: boolean;
  tumblr: boolean;
  facebook: boolean;
  bilibili: boolean;
  twitch: boolean;
  spotify: boolean;
  snapchat: boolean;
  snapchat_view: EmbedEzView;
  snapchat_tr: boolean;
  imgur: boolean;
  imgur_view: EmbedEzView;
  imgur_tr: boolean;
  weibo: boolean;
  weibo_view: EmbedEzView;
  weibo_tr: boolean;
  imageboards: boolean;
  imageboards_view: EmbedEzView;
  pinterest: boolean;
  pinterest_view: EmbedEzView;
  pinterest_tr: boolean;
  newgrounds: boolean;
  fixer_strategy: FixerStrategy;

  private constructor(row: GuildRow) {
    this.id = row.id;
    this.keywords = JSON.parse(row.keywords) as string[];
    this.keywords_use_allow_list = !!row.keywords_use_allow_list;
    this.text_channels_use_allow_list = !!row.text_channels_use_allow_list;
    this.members_use_allow_list = !!row.members_use_allow_list;
    this.roles_use_allow_list = !!row.roles_use_allow_list;
    this.roles_use_any_rule = !!row.roles_use_any_rule;
    this.lang = row.lang;
    this.original_message = row.original_message as OriginalMessage;
    this.reply_to_message = !!row.reply_to_message;
    this.reply_silently = !!row.reply_silently;
    this.reply_as_original_author_replica = !!row.reply_as_original_author_replica;
    this.webhooks = !!row.webhooks;
    this.twitter = !!row.twitter;
    this.twitter_tr = !!row.twitter_tr;
    this.twitter_view = row.twitter_view as FxEmbedView;
    this.instagram = !!row.instagram;
    this.instagram_view = row.instagram_view as InstagramView;
    this.instagram_tr = !!row.instagram_tr;
    this.tiktok = !!row.tiktok;
    this.tiktok_view = row.tiktok_view as TiktokView;
    this.reddit = !!row.reddit;
    this.threads = !!row.threads;
    this.bluesky = !!row.bluesky;
    this.bluesky_view = row.bluesky_view as FxEmbedView;
    this.pixiv = !!row.pixiv;
    this.ifunny = !!row.ifunny;
    this.ifunny_view = row.ifunny_view as EmbedEzView;
    this.ifunny_tr = !!row.ifunny_tr;
    this.furaffinity = !!row.furaffinity;
    this.youtube = !!row.youtube;
    this.mastodon = !!row.mastodon;
    this.deviantart = !!row.deviantart;
    this.tumblr = !!row.tumblr;
    this.facebook = !!row.facebook;
    this.bilibili = !!row.bilibili;
    this.twitch = !!row.twitch;
    this.spotify = !!row.spotify;
    this.snapchat = !!row.snapchat;
    this.snapchat_view = row.snapchat_view as EmbedEzView;
    this.snapchat_tr = !!row.snapchat_tr;
    this.imgur = !!row.imgur;
    this.imgur_view = row.imgur_view as EmbedEzView;
    this.imgur_tr = !!row.imgur_tr;
    this.weibo = !!row.weibo;
    this.weibo_view = row.weibo_view as EmbedEzView;
    this.weibo_tr = !!row.weibo_tr;
    this.imageboards = !!row.imageboards;
    this.imageboards_view = row.imageboards_view as EmbedEzView;
    this.pinterest = !!row.pinterest;
    this.pinterest_view = row.pinterest_view as EmbedEzView;
    this.pinterest_tr = !!row.pinterest_tr;
    this.newgrounds = !!row.newgrounds;
    this.fixer_strategy = row.fixer_strategy as FixerStrategy;
  }

  get custom_websites(): CustomWebsite[] {
    return CustomWebsite.findAllByGuild(this.id);
  }

  get custom_fixers(): CustomFixer[] {
    return CustomFixer.findAllByGuild(this.id);
  }

  static find(id: string): Guild | null {
    const row = getGuildStmt.get(id) as GuildRow | undefined;
    return row ? new Guild(row) : null;
  }

  static findOrCreate(id: string): Guild {
    return Guild.find(id) ?? insertGuild(id);
  }

  update(fields: Partial<Guild>): void {
    const wrote = updateRow('guilds', { id: this.id }, fields, (key, value) => {
      if (key === 'id') return null;
      if (key === 'keywords') return [key, JSON.stringify(value)];
      if (typeof value === 'boolean') return [key, value ? 1 : 0];
      return value !== undefined ? [key, value] : null;
    });
    if (wrote) Object.assign(this, fields);
  }
}

const getGuildStmt = db.prepare('SELECT * FROM guilds WHERE id = ?');
const insertGuildStmt = db.prepare(`INSERT INTO guilds (id, keywords, keywords_use_allow_list, text_channels_use_allow_list, members_use_allow_list, roles_use_allow_list, roles_use_any_rule, lang, original_message, reply_to_message, reply_silently, reply_as_original_author_replica, webhooks, twitter, twitter_tr, twitter_view, instagram, instagram_view, instagram_tr, tiktok, tiktok_view, reddit, threads, bluesky, bluesky_view, pixiv, ifunny, ifunny_view, ifunny_tr, furaffinity, youtube, mastodon, deviantart, tumblr, facebook, bilibili, twitch, spotify, snapchat, snapchat_view, snapchat_tr, imgur, imgur_view, imgur_tr, weibo, weibo_view, weibo_tr, imageboards, imageboards_view, pinterest, pinterest_view, pinterest_tr, newgrounds, fixer_strategy)
  VALUES (@id, @keywords, 0, 0, 0, 0, 0, NULL, 'remove_embeds', 0, 1, 0, 0, 1, 0, 'normal', 1, 'normal', 0, 1, 'normal', 1, 1, 1, 'normal', 1, 1, 'normal', 0, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1, 'normal', 0, 0, 'normal', 0, 1, 'normal', 0, 1, 'normal', 1, 'normal', 0, 1, 'round_robin')`);

export function insertGuild(id: string): Guild {
  insertGuildStmt.run({ id, keywords: JSON.stringify(['fxignore']) });
  return Guild.find(id)!;
}

export interface FilterRow {
  id: string;
  guild_id: string;
  on_deny_list: number;
  on_allow_list: number;
  [key: string]: unknown;
}

export class Filter {
  table: FilterTable;
  id: string;
  guild_id: string;
  on_deny_list: boolean;
  on_allow_list: boolean;
  bot: boolean;

  constructor(table: FilterTable, row: FilterRow) {
    this.table = table;
    this.id = String(row[table === 'members' ? 'user_id' : 'id']);
    this.guild_id = String(row['guild_id']);
    this.on_deny_list = !!row['on_deny_list'];
    this.on_allow_list = !!row['on_allow_list'];
    this.bot = !!row['bot'];
  }

  static findOrCreate(
    table: FilterTable,
    guildId: string,
    dElement: { id?: string | bigint; user?: { id: string | bigint }; bot?: boolean },
    defaults?: Partial<Pick<Filter, 'bot' | 'on_deny_list' | 'on_allow_list'>>,
  ): Filter {
    const id = table === 'members' ? String(dElement.user?.id ?? dElement.id) : String(dElement.id);
    let row = findFilterStmt(table, id).get(id, guildId) as FilterRow | undefined;
    if (!row) {
      const bot = defaults?.bot ?? (table === 'members' ? !!dElement.bot : false);
      const on_deny = defaults?.on_deny_list ?? (table === 'members' && bot ? 1 : 0);
      if (table === 'members') {
        db.prepare('INSERT INTO members (user_id, guild_id, bot, on_deny_list, on_allow_list) VALUES (?, ?, ?, ?, 0)').run(
          id,
          guildId,
          bot ? 1 : 0,
          on_deny ? 1 : 0,
        );
      } else {
        db.prepare(`INSERT INTO ${table} (id, guild_id, on_deny_list, on_allow_list) VALUES (?, ?, ?, 0)`).run(
          id,
          guildId,
          on_deny ? 1 : 0,
        );
      }
      row = findFilterStmt(table, id).get(id, guildId) as FilterRow;
    }
    return new Filter(table, row);
  }

  enabled(guild: Guild): boolean {
    if (guild[`${this.table}_use_allow_list`] as boolean) return this.on_allow_list;
    return !this.on_deny_list;
  }

  onList(guild: Guild): boolean {
    if (guild[`${this.table}_use_allow_list`] as boolean) return this.on_allow_list;
    return this.on_deny_list;
  }

  updateEnabled(enabled: boolean, guild: Guild): void {
    if (guild[`${this.table}_use_allow_list`] as boolean) {
      this.update({ on_allow_list: enabled });
    } else {
      this.update({ on_deny_list: !enabled });
    }
  }

  update(fields: Partial<{ on_deny_list: boolean; on_allow_list: boolean; bot: boolean }>): void {
    const idCol = this.table === 'members' ? 'user_id' : 'id';
    const wrote = updateRow(
      this.table,
      { [idCol]: this.id, guild_id: this.guild_id },
      fields,
      (key, value) => {
        if (typeof value === 'boolean' && (this.table === 'members' || key !== 'bot')) {
          return [key, value ? 1 : 0];
        }
        return null;
      },
    );
    if (wrote) Object.assign(this, fields);
  }

  static findGetEnabled(
    table: FilterTable,
    guildId: string | null,
    dElement: { id?: string | bigint; user?: { id: string | bigint }; bot?: boolean },
  ): boolean {
    if (!guildId) {
      return table === 'members' ? !dElement.bot : true;
    }
    const id = table === 'members' ? String(dElement.user?.id ?? dElement.id) : String(dElement.id);
    const row = findFilterStmt(table, id).get(id, guildId) as FilterRow | undefined;
    if (row) {
      const guild = Guild.find(guildId);
      if (guild) return new Filter(table, row).enabled(guild);
      return !!(row['on_deny_list'] === 0 || row['on_deny_list'] === undefined);
    }
    const guild = Guild.find(guildId);
    if (guild && (guild[`${table}_use_allow_list`] as boolean)) return false;
    return table === 'members' ? !dElement.bot : true;
  }

  static findsGetEnabled(table: FilterTable, guildId: string | null, dRoles: Array<{ id: string | bigint }>): boolean[] {
    if (!guildId) return [true];
    if (table !== 'roles') return [];
    const guild = Guild.find(guildId);
    if (!guild) return [true];
    const ids = new Set(dRoles.map((r) => String(r.id)));
    const results: boolean[] = [];
    const foundIds = new Set<string>();
    for (const row of db
      .prepare(`SELECT * FROM roles WHERE guild_id = ? AND id IN (${[...ids].map(() => '?').join(',')})`)
      .all(guildId, ...[...ids]) as FilterRow[]) {
      results.push(new Filter('roles', row).enabled(guild));
      foundIds.add(String(row['id']));
    }
    const missing = [...ids].filter((id) => !foundIds.has(id)).length;
    if (missing > 0) {
      results.push(...Array(missing).fill(!guild.roles_use_allow_list));
    }
    return results;
  }

  static resetLists(table: FilterTable, guildId: string): void {
    if (table === 'members') {
      db.prepare(`UPDATE ${table} SET on_allow_list = 0 WHERE guild_id = ?`).run(guildId);
      db.prepare(`UPDATE ${table} SET on_deny_list = 0 WHERE guild_id = ? AND bot = 0`).run(guildId);
      db.prepare(`UPDATE ${table} SET on_deny_list = 1 WHERE guild_id = ? AND bot = 1`).run(guildId);
    } else {
      db.prepare(`UPDATE ${table} SET on_allow_list = 0, on_deny_list = 0 WHERE guild_id = ?`).run(guildId);
    }
  }
}

export interface CustomWebsiteRow {
  id: number;
  guild_id: string;
  name: string;
  domain: string;
  fix_domain: string;
}

export class CustomWebsite {
  id: number;
  guild_id: string;
  name: string;
  domain: string;
  fix_domain: string;

  constructor(row: CustomWebsiteRow) {
    this.id = row.id;
    this.guild_id = String(row.guild_id);
    this.name = row.name;
    this.domain = row.domain;
    this.fix_domain = row.fix_domain;
  }

  static find(id: number): CustomWebsite | null {
    const row = db.prepare('SELECT * FROM custom_websites WHERE id = ?').get(id) as CustomWebsiteRow | undefined;
    return row ? new CustomWebsite(row) : null;
  }

  static findAllByGuild(guildId: string): CustomWebsite[] {
    return (db.prepare('SELECT * FROM custom_websites WHERE guild_id = ?').all(guildId) as CustomWebsiteRow[]).map(
      (row) => new CustomWebsite(row),
    );
  }

  static create(guildId: string, data: { name: string; domain: string; fix_domain: string }): CustomWebsite {
    const info = db
      .prepare('INSERT INTO custom_websites (guild_id, name, domain, fix_domain) VALUES (?, ?, ?, ?)')
      .run(guildId, data.name, data.domain, data.fix_domain);
    return CustomWebsite.find(Number(info.lastInsertRowid))!;
  }

  update(fields: Partial<Pick<CustomWebsite, 'name' | 'domain' | 'fix_domain'>>): void {
    const wrote = updateRow('custom_websites', { id: this.id }, fields, (key, value) => {
      return typeof value === 'string' ? [key, value] : null;
    });
    if (wrote) Object.assign(this, fields);
  }

  delete(): void {
    db.prepare('DELETE FROM custom_websites WHERE id = ?').run(this.id);
  }
}

export interface CustomFixerRow {
  id: number;
  guild_id: string;
  website: string;
  fix_domain: string;
}

export class CustomFixer {
  id: number;
  guild_id: string;
  website: string;
  fix_domain: string;

  constructor(row: CustomFixerRow) {
    this.id = row.id;
    this.guild_id = String(row.guild_id);
    this.website = row.website;
    this.fix_domain = row.fix_domain;
  }

  static find(id: number): CustomFixer | null {
    const row = db.prepare('SELECT * FROM custom_fixers WHERE id = ?').get(id) as CustomFixerRow | undefined;
    return row ? new CustomFixer(row) : null;
  }

  static findAllByGuild(guildId: string): CustomFixer[] {
    return (db.prepare('SELECT * FROM custom_fixers WHERE guild_id = ?').all(guildId) as CustomFixerRow[]).map(
      (row) => new CustomFixer(row),
    );
  }

  static create(guildId: string, website: string, fix_domain: string): CustomFixer {
    const info = db
      .prepare('INSERT INTO custom_fixers (guild_id, website, fix_domain) VALUES (?, ?, ?)')
      .run(guildId, website, fix_domain);
    return CustomFixer.find(Number(info.lastInsertRowid))!;
  }

  delete(): void {
    db.prepare('DELETE FROM custom_fixers WHERE id = ?').run(this.id);
  }
}

export type FixerManagerType = 'member' | 'role';

export interface FixerManagerRow {
  id: number;
  guild_id: string;
  target_id: string;
  type: FixerManagerType;
}

export class FixerManager {
  id: number;
  guild_id: string;
  target_id: string;
  type: FixerManagerType;

  constructor(row: FixerManagerRow) {
    this.id = row.id;
    this.guild_id = String(row.guild_id);
    this.target_id = row.target_id;
    this.type = row.type;
  }

  static find(guildId: string, targetId: string, type: FixerManagerType): FixerManager | null {
    const row = db
      .prepare('SELECT * FROM fixer_managers WHERE guild_id = ? AND target_id = ? AND type = ?')
      .get(guildId, targetId, type) as FixerManagerRow | undefined;
    return row ? new FixerManager(row) : null;
  }

  static findAllByGuild(guildId: string): FixerManager[] {
    return (db.prepare('SELECT * FROM fixer_managers WHERE guild_id = ?').all(guildId) as FixerManagerRow[]).map(
      (row) => new FixerManager(row),
    );
  }

  static add(guildId: string, targetId: string, type: FixerManagerType): FixerManager {
    return (
      FixerManager.find(guildId, targetId, type) ??
      (() => {
        const info = db
          .prepare('INSERT INTO fixer_managers (guild_id, target_id, type) VALUES (?, ?, ?)')
          .run(guildId, targetId, type);
        return FixerManager.findById(Number(info.lastInsertRowid))!;
      })()
    );
  }

  static findById(id: number): FixerManager | null {
    const row = db.prepare('SELECT * FROM fixer_managers WHERE id = ?').get(id) as FixerManagerRow | undefined;
    return row ? new FixerManager(row) : null;
  }

  delete(): void {
    db.prepare('DELETE FROM fixer_managers WHERE id = ?').run(this.id);
  }
}

const findFilterStmt = (table: FilterTable, id: string) =>
  db.prepare(`SELECT * FROM ${table} WHERE ${table === 'members' ? 'user_id' : 'id'} = ? AND guild_id = ?`);

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guilds (
      id TEXT PRIMARY KEY,
      keywords TEXT NOT NULL DEFAULT '["fxignore"]',
      keywords_use_allow_list INTEGER NOT NULL DEFAULT 0,
      text_channels_use_allow_list INTEGER NOT NULL DEFAULT 0,
      members_use_allow_list INTEGER NOT NULL DEFAULT 0,
      roles_use_allow_list INTEGER NOT NULL DEFAULT 0,
      roles_use_any_rule INTEGER NOT NULL DEFAULT 0,
      lang TEXT,
      original_message TEXT NOT NULL DEFAULT 'remove_embeds',
      reply_to_message INTEGER NOT NULL DEFAULT 0,
      reply_silently INTEGER NOT NULL DEFAULT 1,
      reply_as_original_author_replica INTEGER NOT NULL DEFAULT 0,
      webhooks INTEGER NOT NULL DEFAULT 0,
      twitter INTEGER NOT NULL DEFAULT 1,
      twitter_tr INTEGER NOT NULL DEFAULT 0,
      twitter_view TEXT NOT NULL DEFAULT 'normal',
      instagram INTEGER NOT NULL DEFAULT 1,
      instagram_view TEXT NOT NULL DEFAULT 'normal',
      instagram_tr INTEGER NOT NULL DEFAULT 0,
      tiktok INTEGER NOT NULL DEFAULT 1,
      tiktok_view TEXT NOT NULL DEFAULT 'normal',
      reddit INTEGER NOT NULL DEFAULT 1,
      threads INTEGER NOT NULL DEFAULT 1,
      bluesky INTEGER NOT NULL DEFAULT 1,
      bluesky_view TEXT NOT NULL DEFAULT 'normal',
      pixiv INTEGER NOT NULL DEFAULT 1,
      ifunny INTEGER NOT NULL DEFAULT 1,
      ifunny_view TEXT NOT NULL DEFAULT 'normal',
      ifunny_tr INTEGER NOT NULL DEFAULT 0,
      furaffinity INTEGER NOT NULL DEFAULT 1,
      youtube INTEGER NOT NULL DEFAULT 0,
      mastodon INTEGER NOT NULL DEFAULT 0,
      deviantart INTEGER NOT NULL DEFAULT 1,
      tumblr INTEGER NOT NULL DEFAULT 0,
      facebook INTEGER NOT NULL DEFAULT 1,
      bilibili INTEGER NOT NULL DEFAULT 1,
      twitch INTEGER NOT NULL DEFAULT 1,
      spotify INTEGER NOT NULL DEFAULT 0,
      snapchat INTEGER NOT NULL DEFAULT 1,
      snapchat_view TEXT NOT NULL DEFAULT 'normal',
      snapchat_tr INTEGER NOT NULL DEFAULT 0,
      imgur INTEGER NOT NULL DEFAULT 0,
      imgur_view TEXT NOT NULL DEFAULT 'normal',
      imgur_tr INTEGER NOT NULL DEFAULT 0,
      weibo INTEGER NOT NULL DEFAULT 1,
      weibo_view TEXT NOT NULL DEFAULT 'normal',
      weibo_tr INTEGER NOT NULL DEFAULT 0,
      imageboards INTEGER NOT NULL DEFAULT 1,
      imageboards_view TEXT NOT NULL DEFAULT 'normal',
      pinterest INTEGER NOT NULL DEFAULT 1,
      pinterest_view TEXT NOT NULL DEFAULT 'normal',
      pinterest_tr INTEGER NOT NULL DEFAULT 0,
      newgrounds INTEGER NOT NULL DEFAULT 1,
      fixer_strategy TEXT NOT NULL DEFAULT 'round_robin'
    );
    CREATE TABLE IF NOT EXISTS text_channels (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      on_deny_list INTEGER NOT NULL DEFAULT 0,
      on_allow_list INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      bot INTEGER NOT NULL DEFAULT 0,
      on_deny_list INTEGER NOT NULL DEFAULT 0,
      on_allow_list INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      on_deny_list INTEGER NOT NULL DEFAULT 0,
      on_allow_list INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS custom_websites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      fix_domain TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS custom_fixers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      website TEXT NOT NULL,
      fix_domain TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fixer_managers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_members_user ON members (guild_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_filters_guild ON text_channels (guild_id);
    CREATE INDEX IF NOT EXISTS idx_roles_guild ON roles (guild_id);
    CREATE INDEX IF NOT EXISTS idx_custom_websites_guild ON custom_websites (guild_id);
    CREATE INDEX IF NOT EXISTS idx_custom_fixers_guild ON custom_fixers (guild_id);
    CREATE INDEX IF NOT EXISTS idx_fixer_managers_guild ON fixer_managers (guild_id);
  `);
  const cols = db.prepare('PRAGMA table_info(guilds)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'fixer_strategy')) {
    db.exec(`ALTER TABLE guilds ADD COLUMN fixer_strategy TEXT NOT NULL DEFAULT 'round_robin'`);
  }
}