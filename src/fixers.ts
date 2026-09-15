export interface Fixer {
  domain: string;
  name: string;
  default?: boolean;
  subdomains?: Record<string, string>;
  isTranslation?: boolean;
}

export const FIXER_STRATEGIES = ['default', 'round_robin', 'first_come_first_served'] as const;
export type FixerStrategy = (typeof FIXER_STRATEGIES)[number];

export const FIXERS: Record<string, Fixer[]> = {
  twitter: [
    {
      domain: 'fxtwitter.com',
      name: 'FxTwitter',
      default: true,
      subdomains: { normal: '', gallery: 'g.', text_only: 't.', direct_media: 'd.' },
      isTranslation: true,
    },
    {
      domain: 'fixupx.com',
      name: 'FixupX',
      subdomains: { normal: '', gallery: 'g.', text_only: 't.', direct_media: 'd.' },
      isTranslation: true,
    },
  ],
  instagram: [
    { domain: 'oginstagram.com', name: 'OGInstagram', default: true },
    { domain: 'toinstagram.com', name: 'InstaFix (toInstagram)' },
    { domain: 'eeinstagram.com', name: 'FixEmbeds (eeInstagram)' },
  ],
};

export function getFixers(websiteId: string): Fixer[] {
  return FIXERS[websiteId] ?? [];
}

// ponytail: in-memory round-robin cursor, resets on restart; map it to a table if per-guild fairness is ever needed
const rrNext: Record<string, number> = {};

export function nextFixerIndex(websiteId: string, strategy: FixerStrategy): number {
  const list = getFixers(websiteId);
  if (list.length === 0) return 0;
  if (strategy === 'first_come_first_served') return 0;
  if (strategy === 'default') {
    const def = list.findIndex((fixer) => fixer.default);
    return def === -1 ? 0 : def;
  }
  const index = (rrNext[websiteId] ?? 0) % list.length;
  rrNext[websiteId] = index + 1;
  return index;
}