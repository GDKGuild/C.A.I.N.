import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const dbPath = path.join(os.tmpdir(), `fixtweet-test-${process.pid}.sqlite`);
process.env.DB_PATH = dbPath;

const fixturePath = String.raw`C:\Users\PC\AppData\Local\Temp\opencode\fixtweet\websites_fixture.json`;

let fixture: any = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
let insertGuild: (id: string) => any;
let CustomWebsite: any;
let websites: Array<any>;
let db: any;

interface CaseResult {
  valid?: boolean;
  fixed_url?: string | null;
  fixer_name?: string | null;
  prepared_url?: string;
  author_url?: string | null;
  author_label?: string | null;
  original_url?: string | null;
  original_label?: string | null;
}

beforeAll(async () => {
  fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  db = await import('../src/db');
  insertGuild = db.insertGuild;
  CustomWebsite = db.CustomWebsite;
  const ws = await import('../src/websites');
  websites = ws.websites;
});

afterAll(() => {
  db?.db?.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
  vi.unstubAllGlobals();
});

function unanchor(source: string): string {
  if (source.startsWith('^(?:') && source.endsWith(')$')) {
    return source.slice(4, -2);
  }
  return source;
}

// V8's RegExp.source escapes forward slashes as \/; Python's pattern does not.
// Python wraps query-param lookaheads as (?:(?=...))?; V8 drops the named group
// in that form, so we emit the equivalent non-wrapped lookahead. Canonicalize.
function compareSource(source: string): string {
  return unanchor(source)
    .replace(/\\\//g, '/')
    .replace(/\(\?:\(\?=\(\?:\\\?\|\.\*&\)(\w+)=\(\?<\1>\[\^\&#\]\+\)\)\)\?/g, '(?=(?:(?:\\?|.*&)$1=(?<$1>[^&#]+)))');
}

async function runCase(clsName: string, url: string, guildId: string, mutate?: (g: any) => void): Promise<CaseResult> {
  const guild = insertGuild(guildId);
  mutate?.(guild);
  const cls = websites.find((c: any) => c.name === clsName);
  if (!cls) throw new Error(`no class ${clsName}`);
  const link = new cls(guild, url);
  const result: CaseResult = { valid: link.isValid() };
  if (result.valid) {
    if (cls.fixerName !== 'EmbedEZ') {
      const [fixedUrl, fixerName] = await link.getFixedUrl();
      result.fixed_url = fixedUrl;
      result.fixer_name = fixerName;
    }
    const [authorUrl, authorLabel] = await link.getAuthorUrl();
    const [originalUrl, originalLabel] = await link.getOriginalUrl();
    if (authorUrl) result.author_url = authorUrl;
    if (authorLabel) result.author_label = authorLabel;
    if (originalUrl) result.original_url = originalUrl;
    if (originalLabel) result.original_label = originalLabel;
  }
  return result;
}

describe('regex parity with Python fixture', () => {
  it('generates regexes identical to the Python source (un-anchored)', () => {
    const expected: Record<string, string> = fixture.regexes;
    const actual: Record<string, string> = {};
    for (const cls of websites) {
      const routes = cls.routes as Record<string, RegExp> | undefined;
      if (!routes) continue;
      for (const [route, regex] of Object.entries(routes)) {
        actual[`${cls.id}:${route}`] = compareSource(regex.source);
      }
    }
    for (const [key, source] of Object.entries(expected)) {
      expect(actual[key], `route ${key}`).toBe(compareSource(source));
    }
    expect(Object.keys(actual).length).toBe(Object.keys(expected).length);
  });
});

describe('case parity with Python fixture', () => {
  for (const [caseName, entry] of Object.entries<{ cls: string; url?: string; result?: CaseResult }>(fixture.cases)) {
    if (entry.cls === 'CustomLink') continue;
    it(caseName, async () => {
      const guildId = `g-${caseName}`;
      const expected = entry;
      let actual: CaseResult;
      if (caseName === 'twitter_tr') {
        actual = await runCase(expected.cls, expected.url!, guildId, (g) => {
          g.update({ lang: 'en', twitter_tr: true });
        });
      } else if (caseName === 'twitter_gallery') {
        actual = await runCase(expected.cls, expected.url!, guildId, (g) => {
          g.update({ twitter_view: 'gallery' });
        });
      } else {
        actual = await runCase(expected.cls, expected.url!, guildId);
      }
      const expectedResult = expected.result!;
      expect(actual.valid).toBe(expectedResult.valid);
      if (!expectedResult.valid) return;
      if ('prepared_url' in expectedResult) {
        expect(actual.fixed_url).toBeUndefined();
      } else {
        expect(actual.fixed_url).toBe(expectedResult.fixed_url);
        expect(actual.fixer_name).toBe(expectedResult.fixer_name);
      }
      expect(actual.author_url ?? null).toBe(expectedResult.author_url ?? null);
      expect(actual.author_label ?? null).toBe(expectedResult.author_label ?? null);
      expect(actual.original_url ?? null).toBe(expectedResult.original_url ?? null);
      expect(actual.original_label ?? null).toBe(expectedResult.original_label ?? null);
    });
  }
});

describe('embedez prepared_url parity', () => {
  const embedezCases = Object.entries<{ cls: string; url?: string; result?: CaseResult }>(fixture.cases).filter(
    ([, entry]) => entry.result && 'prepared_url' in entry.result,
  );
  it.each(embedezCases)('%s', async (caseName, entry) => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      return {
        status: 200,
        text: async () => '',
        json: async () => ({ data: { key: 'mocked-key' } }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const guild = insertGuild(`ge-${caseName}`);
    const cls = websites.find((c: any) => c.name === entry.cls);
    const link = new cls(guild, entry.url!);
    const [fixedUrl] = await link.getFixedUrl();
    expect(fixedUrl).toBe('https://embedez.com/embed/mocked-key');
    const fetched = fetchMock.mock.calls[0][0] as string;
    const q = new URLSearchParams(new URL(fetched).search).get('q');
    expect(q).toBe(entry.result!.prepared_url);
    vi.unstubAllGlobals();
  });
});

describe('custom website parity', () => {
  it('resolves custom domains', async () => {
    const guild = insertGuild('g-custom');
    CustomWebsite.create(guild.id, { name: 'Example', domain: 'example.com', fix_domain: 'fix.example.net' });
    const CustomLink = websites.find((c: any) => c.name === 'CustomLink');
    const entry = fixture.cases['custom'] as { cls: string };
    for (const [key, value] of Object.entries(entry)) {
      if (!key.startsWith('http')) continue;
      const expected = value as CaseResult;
      const link = new CustomLink(guild, key);
      expect(link.isValid()).toBe(expected.valid);
      if (!expected.valid) continue;
      const [fixedUrl, fixerName] = await link.getFixedUrl();
      const [originalUrl, originalLabel] = await link.getOriginalUrl();
      expect(fixedUrl).toBe(expected.fixed_url);
      expect(fixerName).toBe(expected.fixer_name);
      expect(originalUrl).toBe(expected.original_url);
      expect(originalLabel).toBe(expected.original_label);
    }
  });
});