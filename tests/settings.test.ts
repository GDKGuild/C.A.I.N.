import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ButtonBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';

const dbPath = path.join(os.tmpdir(), `settings-test-${process.pid}.sqlite`);
process.env.DB_PATH = dbPath;

let db: any;
let Guild: any;

beforeAll(async () => {
  db = await import('../src/db');
  Guild = db.Guild;
});

afterAll(() => {
  db?.db?.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

const fakeBot = { user: { username: 'FixTest', id: '1' } };
const fakeChannel = {
  id: '2',
  guild: { members: {}, name: 'Test Guild' },
  permissionsFor: (): null => null,
  toString: (): string => '<#2>',
};
const fakeInteraction = {
  locale: 'en-US',
  client: fakeBot,
  guild: { id: 'g1' },
  user: { id: 'u1' },
};
const fakeCtx = (guild: any): any => ({
  guild: { discordObject: { id: 'g1' }, dbObject: guild },
  member: { mention: '<@1>', guildId: 'g1' },
  channel: { mention: '<#2>', discordObject: fakeChannel },
  role: { mention: '<@&3>' },
  roles: [],
});
const stubView = { register: (): void => undefined, refresh: async (): Promise<void> => undefined };
const fakeToggle = { isMessageComponent: (): boolean => true, isStringSelectMenu: (): boolean => false, locale: 'en-GB' };
const fakeSelect = { isMessageComponent: (): boolean => true, isStringSelectMenu: (): boolean => true, locale: 'en-GB', values: ['nothing'] };

describe('website settings', () => {
  it('initializes state from the guild row on first use and toggles persist', async () => {
    const guild = Guild.findOrCreate('g1');
    const { TwitterSetting } = await import('../src/views/settings');

    let setting = new TwitterSetting(fakeInteraction as any, stubView as any, fakeCtx(guild) as any);
    await setting.embed();
    expect(setting.state).toBe(true);
    expect(setting.translation).toBe(false);
    expect(setting.view_state).toBe('normal');

    await setting.action(fakeToggle as any);
    expect(setting.state).toBe(false);
    expect(Guild.find('g1')!.twitter).toBe(false);

    const reload = await import('../src/views/settings');
    setting = new reload.TwitterSetting(fakeInteraction as any, stubView as any, fakeCtx(Guild.findOrCreate('g1')) as any);
    await setting.embed();
    expect(setting.state).toBe(false);
  });

  it('toggles translation and sets the default lang from the interaction locale', async () => {
    const guild = Guild.findOrCreate('g1');
    const { TwitterSetting } = await import('../src/views/settings');
    const setting = new TwitterSetting(fakeInteraction as any, stubView as any, fakeCtx(guild) as any);
    await setting.embed();
    await setting.translationAction(fakeToggle as any);
    expect(setting.translation).toBe(true);
    expect(Guild.find('g1')!.twitter_tr).toBe(true);
    expect(Guild.find('g1')!.lang).toBe('en');
  });
});

describe('original message behavior', () => {
  it('builds a select with all options and persists the choice', async () => {
    const guild = Guild.findOrCreate('g1');
    const { OriginalMessageBehaviorSetting } = await import('../src/views/settings');
    const setting = new OriginalMessageBehaviorSetting(fakeInteraction as any, stubView as any, fakeCtx(guild) as any);
    expect(setting.state).toBe('remove_embeds');

    const items = await setting.items();
    expect(items).toHaveLength(1);

    const select = items[0].builder as StringSelectMenuBuilder;
    expect(select.toJSON().custom_id).toBe('original_message_select');
    const options = select.toJSON().options;
    expect(options.map((o) => o.value)).toEqual(['nothing', 'remove_embeds', 'delete']);

    await setting.action(fakeSelect as any);
    expect(Guild.find('g1')!.original_message).toBe('nothing');
  });
});

describe('packRows', () => {
  it('honors explicit rows and packs overflowing items into a new row', async () => {
    const { packRows } = await import('../src/views/settings');
    const button = (id: string): RowItem => ({ builder: new ButtonBuilder().setCustomId(id).setLabel(id) });
    const select = (id: string, row?: number): RowItem => ({ builder: new StringSelectMenuBuilder().setCustomId(id), row });

    const rows = packRows([
      button('auto1'),
      select('row3', 3),
      button('auto2'),
      select('row4', 4),
      button('auto3'),
      button('auto4'),
      button('auto5'),
      button('auto6'),
    ] as RowItem[]);
    const byId = (row: any): string[] => row.toJSON().components.map((c: any) => c.custom_id);
    expect(byId(rows[0])).toEqual(['auto1', 'auto2', 'auto3', 'auto4', 'auto5']);
    expect(byId(rows[1])).toEqual(['auto6']);
    expect(byId(rows[2])).toEqual(['row3']);
    expect(byId(rows[3])).toEqual(['row4']);
  });
});