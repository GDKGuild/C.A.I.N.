import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WebsiteLink } from '../src/websites';

const dbPath = path.join(os.tmpdir(), `revert-test-${process.pid}.sqlite`);
process.env.DB_PATH = dbPath;

let db: any;
let revert: any;

class FakeLink extends WebsiteLink {
  isValid(): boolean {
    return true;
  }

  async getFixedUrl(): Promise<[string | null, string | null]> {
    return [null, null];
  }

  async getAuthorUrl(): Promise<[string | null, string | null]> {
    return [null, null];
  }

  async getOriginalUrl(): Promise<[string | null, string | null]> {
    return [null, null];
  }
}

const link = (url: string): FakeLink => new FakeLink(null as any, url);

beforeAll(async () => {
  db = await import('../src/db');
  revert = await import('../src/linkFix');
});

afterAll(() => {
  db?.db?.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('revertContent', () => {
  it('returns a single original url', () => {
    expect(revert.revertContent([link('https://twitter.com/user/status/1')])).toBe(
      'https://twitter.com/user/status/1',
    );
  });

  it('joins multiple original urls with newlines', () => {
    expect(revert.revertContent([link('https://a.com/1'), link('https://b.com/2')])).toBe(
      'https://a.com/1\nhttps://b.com/2',
    );
  });

  it('groups long lists within the 2000 char limit', () => {
    const urls = Array.from({ length: 40 }, (_, i) => `https://twitter.com/user/status/${i}`.padEnd(60, 'x'));
    const content = revert.revertContent(urls.map((u) => link(u)));
    for (const line of content.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(2000);
    }
    expect(content.split('\n').length).toBeGreaterThan(1);
  });
});

describe('isRevertInteractionId', () => {
  it('accepts revert button ids', () => {
    expect(revert.isRevertInteractionId('fixer_revert_keep_abc')).toBe(true);
    expect(revert.isRevertInteractionId('fixer_revert_do_abc')).toBe(true);
  });

  it('rejects unrelated ids', () => {
    expect(revert.isRevertInteractionId('settings_toggle_strategy')).toBe(false);
    expect(revert.isRevertInteractionId('list_add_link')).toBe(false);
  });
});