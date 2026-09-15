import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const dbPath = path.join(os.tmpdir(), `fixers-test-${process.pid}.sqlite`);
process.env.DB_PATH = dbPath;

let insertGuild: (id: string) => any;
let db: any;
let ws: any;
let nextFixerIndex: (websiteId: string, strategy: string) => number;
let getFixers: (websiteId: string) => any[];

beforeAll(async () => {
  db = await import('../src/db');
  insertGuild = db.insertGuild;
  const fx = await import('../src/fixers');
  nextFixerIndex = fx.nextFixerIndex;
  getFixers = fx.getFixers;
  ws = await import('../src/websites');
});

afterAll(() => {
  db?.db?.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

function newLink(guild: any, clsName: string, url: string) {
  const cls = ws.websites.find((c: any) => c.name === clsName);
  if (!cls) throw new Error(`no class ${clsName}`);
  return new cls(guild, url);
}

function hostOf(rendered: string | null | undefined): string | null {
  const m = rendered?.match(/]\((https:\/\/[^)]+)\)/);
  return m?.[1] ? new URL(m[1]).hostname : null;
}

const TWITTER = 'https://twitter.com/Jack/status/20';
const INSTAGRAM = 'https://www.instagram.com/p/Cx12345/';

describe('fixer registry', () => {
  it('registers multiple fixers for twitter and instagram, none for others', () => {
    expect(getFixers('twitter').map((f) => f.domain)).toEqual(['fxtwitter.com', 'fixupx.com']);
    expect(getFixers('instagram').map((f) => f.domain)).toEqual([
      'oginstagram.com',
      'toinstagram.com',
      'eeinstagram.com',
    ]);
    expect(getFixers('reddit')).toEqual([]);
  });
});

describe('nextFixerIndex', () => {
  it('default and first_come_first_served always pick the leading fixer', () => {
    expect(nextFixerIndex('twitter', 'default')).toBe(0);
    expect(nextFixerIndex('twitter', 'first_come_first_served')).toBe(0);
    expect(nextFixerIndex('reddit', 'round_robin')).toBe(0);
  });

  it('round robin cycles and wraps', () => {
    const seq = [
      nextFixerIndex('instagram', 'round_robin'),
      nextFixerIndex('instagram', 'round_robin'),
      nextFixerIndex('instagram', 'round_robin'),
      nextFixerIndex('instagram', 'round_robin'),
    ];
    expect(new Set(seq)).toEqual(new Set([0, 1, 2]));
    expect(seq[3]).toBe(seq[0]);
  });
});

describe('end-to-end fixer selection', () => {
  it('default strategy uses the original fixer', async () => {
    const guild = insertGuild('f-default');
    guild.update({ fixer_strategy: 'default' });
    expect(hostOf(await newLink(guild, 'TwitterLink', TWITTER).render())).toBe('fxtwitter.com');
    expect(hostOf(await newLink(guild, 'InstagramLink', INSTAGRAM).render())).toBe('oginstagram.com');
  });

  it('first_come_first_served stays on the original fixer', async () => {
    const guild = insertGuild('f-fcfs');
    guild.update({ fixer_strategy: 'first_come_first_served' });
    expect(hostOf(await newLink(guild, 'TwitterLink', TWITTER).render())).toBe('fxtwitter.com');
    expect(hostOf(await newLink(guild, 'TwitterLink', TWITTER).render())).toBe('fxtwitter.com');
  });

  it('round robin alternates between the registered fixers', async () => {
    const guild = insertGuild('f-rr');
    guild.update({ fixer_strategy: 'round_robin' });
    const a = hostOf(await newLink(guild, 'TwitterLink', TWITTER).render());
    const b = hostOf(await newLink(guild, 'TwitterLink', TWITTER).render());
    expect(a).not.toBe(b);
    expect(new Set([a, b])).toEqual(new Set(['fxtwitter.com', 'fixupx.com']));
  });

  it('instagram fixers carry no subdomain or translation segment', async () => {
    const guild = insertGuild('f-ig');
    guild.update({
      fixer_strategy: 'round_robin',
      lang: 'en',
      instagram_tr: true,
      twitter_tr: true,
      twitter_view: 'gallery',
      instagram_view: 'gallery',
    });
    const [url] = (await newLink(guild, 'InstagramLink', INSTAGRAM).getFixedUrl()) as unknown as [string, string];
    const host = url.replace(/^https:\/\/([^/]+)\/.*$/, '$1');
    expect(['oginstagram.com', 'toinstagram.com', 'eeinstagram.com']).toContain(host);
    expect(url).toBe(`https://${host}/p/Cx12345`);
    const [txt] = (await newLink(guild, 'TwitterLink', TWITTER).getFixedUrl()) as unknown as [string, string];
    expect(txt).toBe('https://g.fxtwitter.com/i/status/20/en');
  });

  it('websites outside the registry keep their legacy fixer without failover', async () => {
    const guild = insertGuild('f-reddit');
    const link = newLink(guild, 'RedditLink', 'https://www.reddit.com/r/programming/comments/abc/title/');
    expect(hostOf(await link.render())).toBe('vxreddit.com');
    expect(await link.retryNextFixer()).toBeNull();
  });

  it('retryNextFixer fails over to the alternate fixer', async () => {
    const guild = insertGuild('f-failover');
    guild.update({ fixer_strategy: 'default' });
    const link = newLink(guild, 'TwitterLink', TWITTER);
    expect(hostOf(await link.render())).toBe('fxtwitter.com');
    expect(hostOf(await link.retryNextFixer())).toBe('fixupx.com');
    expect(hostOf(await link.retryNextFixer())).toBe('fxtwitter.com');
  });

  it('fixer_strategy persists to the database', () => {
    const guild = insertGuild('f-persist');
    guild.update({ fixer_strategy: 'first_come_first_served' });
    expect(db.Guild.find('f-persist').fixer_strategy).toBe('first_come_first_served');
  });
});