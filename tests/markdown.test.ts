import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { parse, getEmbeddableUrls, type EmbeddableUrl } from '../src/markdown';

const fixturePath = String.raw`C:\Users\PC\AppData\Local\Temp\opencode\fixtweet\markdown_fixture.json`;
const fixture: { results: Array<{ text: string; urls: Array<[string, boolean]>; tree: unknown }> } = JSON.parse(
  fs.readFileSync(fixturePath, 'utf8'),
);

describe('markdown URL extraction parity with dmap', () => {
  for (const sample of fixture.results) {
    it(JSON.stringify(sample.text), () => {
      const nodes = parse(sample.text);
      const urls: EmbeddableUrl[] = getEmbeddableUrls(nodes);
      const expected = sample.urls;
      expect(urls).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(urls[i].url).toBe(expected[i][0]);
        expect(urls[i].spoiler).toBe(expected[i][1]);
      }
    });
  }
});
