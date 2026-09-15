import { CustomWebsite, Guild } from './db';
import { Fixer, getFixers, nextFixerIndex } from './fixers';

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateRegex(domainNames: string | string[], route: string, params: string[] | null = null): RegExp {
  if (route[0] !== '/') {
    route = '/' + route;
  }

  const domains = Array.isArray(domainNames) ? domainNames : [domainNames];
  const domainRegex = `(?<domain>${domains.map(escapeRe).join('|')})`;

  let routeRegex = route;
  routeRegex = routeRegex.replace(/\/:(\w+)\(([^/]+)\)\?/g, '(?:/(?:$2))?');
  routeRegex = routeRegex.replace(/\/:(\w+)\?/g, '(?:/[^/?#]+)?');
  routeRegex = routeRegex.replace(/([^?]):(\w+)\(([^/]+)\)/g, '$1(?<$2>$3)');
  routeRegex = routeRegex.replace(/([^?]):(\w+)/g, '$1(?<$2>[^/?#]+)');

  const queryStringParamRegexes = (params ?? []).map(
    (param) => `(?=(?:(?:\\?|.*&)${param}=(?<${param}>[^&#]+)))`,
  );
  const queryStringRegex = `/?(?:${queryStringParamRegexes.join('')}\\?[^#]+)?\\??`;

  return new RegExp(
    `^(?:https?://(?:(?<subdomain>[^.]+)\\.)?${domainRegex}${routeRegex}${queryStringRegex}(?:#.+)?)$`,
    'i',
  );
}

function generateRoutes(
  domainNames: string | string[],
  routes: Record<string, string[] | null>,
): Record<string, RegExp> {
  const out: Record<string, RegExp> = {};
  for (const [route, params] of Object.entries(routes)) {
    out[route] = generateRegex(domainNames, route, params);
  }
  return out;
}

export abstract class WebsiteLink {
  guild: Guild;
  url: string;
  spoiler: boolean;
  private _rendered: string | null = null;
  protected fixerIndex = 0;
  protected fixerCount = 0;
  protected fixerOverride: number | null = null;

  constructor(guild: Guild, url: string, spoiler = false) {
    this.guild = guild;
    this.url = url;
    this.spoiler = spoiler;
  }

  abstract isValid(): boolean;
  abstract getFixedUrl(): Promise<[string | null, string | null]>;
  abstract getAuthorUrl(): Promise<[string | null, string | null]>;
  abstract getOriginalUrl(): Promise<[string | null, string | null]>;

  async render(): Promise<string | null> {
    if (this._rendered !== null) {
      return this._rendered;
    }
    const [fixedUrl, fixedLabel] = await this.getFixedUrl();
    if (!fixedUrl) {
      return null;
    }
    const [authorUrl, authorLabel] = await this.getAuthorUrl();
    const [originalUrl, originalLabel] = await this.getOriginalUrl();
    let fixedLink = `[${originalLabel}](<${originalUrl}>)`;
    if (authorUrl && authorLabel) {
      const mentionSpace =
        authorLabel.startsWith('everyone') || authorLabel.startsWith('here') ? ' ' : '';
      fixedLink += ` • [@${mentionSpace}${authorLabel}](<${authorUrl}>)`;
    }
    fixedLink += ` • [${fixedLabel}](${fixedUrl})`;
    if (this.spoiler) {
      fixedLink = `||${fixedLink} ||`;
    }
    this._rendered = fixedLink;
    return this._rendered;
  }

  get rendered(): string | null {
    return this._rendered;
  }

  async retryNextFixer(): Promise<string | null> {
    if (this.fixerCount <= 1 || this._rendered === null) {
      return null;
    }
    this._rendered = null;
    this.fixerOverride = (this.fixerIndex + 1) % this.fixerCount;
    const out = await this.render();
    this.fixerOverride = null;
    return out;
  }
}

export class GenericWebsiteLink extends WebsiteLink {
  static id = '';
  static hypertextLabel = '';
  static fixerName = '';
  static fixDomain = '';
  static subdomains: Record<string, string> | null = null;
  static isTranslation = false;
  static isSsl = true;
  static routes: Record<string, RegExp> = {};

  match: RegExpExecArray | null;
  repl: string | null;

  constructor(guild: Guild, url: string, spoiler = false) {
    super(guild, url, spoiler);
    const [match, repl] = this.getMatchAndRepl();
    this.match = match;
    this.repl = repl;
  }

  static ifValid(guild: Guild, url: string, spoiler = false): GenericWebsiteLink | null {
    const cls = this as unknown as typeof GenericWebsiteLink;
    if (!guild[cls.id as keyof Guild]) {
      return null;
    }
    const website = new cls(guild, url, spoiler);
    return website.isValid() ? website : null;
  }

  protected get staticC(): typeof GenericWebsiteLink {
    return this.constructor as typeof GenericWebsiteLink;
  }

  label(): string {
    return this.staticC.hypertextLabel;
  }

  isValid(): boolean {
    return !!this.match;
  }

  getRepl(route: string, match: RegExpExecArray): string {
    if (route[0] !== '/') {
      route = '/' + route;
    }

    const foundPathSegments = [...route.matchAll(/:(\w+)(?:\([^/]+\))?/g)].map((m) => m[1]);

    const groups = match.groups ?? {};
    const params = Object.entries(groups)
      .filter(
        ([gName, gValue]) =>
          !foundPathSegments.includes(gName) &&
          gValue !== undefined &&
          gValue !== null &&
          gName !== 'domain' &&
          gName !== 'subdomain',
      )
      .map(([gName]) => gName);

    let routeRepl = route;
    routeRepl = routeRepl.replace(/\/:(\w+)(?:\([^/]+\))?\?/g, '');
    routeRepl = routeRepl.replace(/:(\w+)(?:\([^/]+\))?/g, '\\g<$1>');

    const queryStringRepl =
      params.length > 0 ? '?' + params.map((param) => `${param}=\\g<${param}>`).join('&') : '';

    return (
      (this.staticC.isSsl ? 'https' : 'http') +
      '://{domain}' +
      routeRepl +
      '{post_path_segments}' +
      queryStringRepl
    );
  }

  routeFixPostPathSegments(): string {
    if (!this.staticC.isTranslation) {
      return '';
    }
    return this.guild[`${this.staticC.id}_tr` as keyof Guild]
      ? `/${this.guild.lang}`
      : '';
  }

  routeFixSubdomain(): string {
    if (!this.staticC.subdomains) {
      return '';
    }
    // noinspection
    const view = this.guild[`${this.staticC.id}_view` as keyof Guild] as string;
    return this.staticC.subdomains[view] ?? '';
  }

  getMatchAndRepl(): [RegExpExecArray | null, string | null] {
    for (const [route, regex] of Object.entries(this.staticC.routes)) {
      const match = regex.exec(this.url);
      if (match) {
        return [match, this.getRepl(route, match)];
      }
    }
    return [null, null];
  }

  getPatchedUrl(domain: string, subdomain = '', postPathSegments = ''): string {
    const repl = String(this.repl).replace(/\\g<author>/g, 'i');
    const formatted = repl
      .replace(/\{domain\}/g, subdomain + domain)
      .replace(/\{post_path_segments\}/g, postPathSegments);
    return expandMatch(this.match!, formatted);
  }

  async getFixedUrl(): Promise<[string | null, string | null]> {
    const registry = getFixers(this.staticC.id);
    const customs = this.guild.custom_fixers
      .filter((custom) => custom.website === this.staticC.id)
      .map<Fixer>((custom) => ({ domain: custom.fix_domain, name: custom.fix_domain }));
    const fixers = registry.length > 0 ? [...registry, ...customs] : [];
    if (fixers.length > 0) {
      const fixerIndex = this.fixerOverride ?? nextFixerIndex(this.staticC.id, fixers, this.guild.fixer_strategy);
      const fixer = fixers[fixerIndex];
      this.fixerIndex = fixerIndex;
      this.fixerCount = fixers.length;
      const subdomain = fixer.subdomains ? (fixer.subdomains[this.currentView()] ?? '') : '';
      const postPathSegments = fixer.isTranslation ? this.routeFixPostPathSegments() : '';
      return [this.getPatchedUrl(fixer.domain, subdomain, postPathSegments), fixer.name];
    }
    return [
      this.getPatchedUrl(this.staticC.fixDomain, this.routeFixSubdomain(), this.routeFixPostPathSegments()),
      this.staticC.fixerName,
    ];
  }

  private currentView(): string {
    const view = this.guild[`${this.staticC.id}_view` as keyof Guild] as string;
    return view ?? 'normal';
  }

  async getAuthorUrl(): Promise<[string | null, string | null]> {
    const groups = this.match!.groups ?? {};
    if (!('username' in groups) || !groups['username']) {
      return [null, null];
    }
    const username = groups['username'];
    const userLink = (await this.getOriginalUrl())[0]!.split(username)[0] + username;
    return [userLink, username];
  }

  async getOriginalUrl(): Promise<[string | null, string | null]> {
    const groups = this.match!.groups ?? {};
    let subdomain = '';
    if (groups['subdomain'] && groups['subdomain'] !== 'www') {
      subdomain = groups['subdomain'] + '.';
    }
    const originalUrl = this.getPatchedUrl(groups['domain'] ?? '', subdomain);
    return [originalUrl, this.label()];
  }
}

function expandMatch(match: RegExpExecArray, template: string): string {
  const groups = match.groups ?? {};
  return template.replace(/\\g<(\w+)>/g, (_, name: string) => groups[name] as string ?? '');
}

export class EmbedEZLink extends GenericWebsiteLink {
  static fixerName = 'EmbedEZ';
  static subdomains: Record<string, string> = { normal: '', direct_media: 'd.' };
  static isTranslation = true;

  async getFixedUrl(): Promise<[string | null, string | null]> {
    const groups = this.match!.groups ?? {};
    let subdomain = '';
    if (groups['subdomain'] && groups['subdomain'] !== 'www') {
      subdomain = groups['subdomain'] + '.';
    }
    subdomain = this.routeFixSubdomain() + subdomain;
    const preparedUrl = this.getPatchedUrl(
      groups['domain'] ?? '',
      subdomain,
      this.routeFixPostPathSegments(),
    );
    try {
      const response = await fetch(
        `https://embedez.com/api/v1/providers/combined?q=${encodeURIComponent(preparedUrl)}`,
        { signal: AbortSignal.timeout(9000) },
      );
      if (response.status !== 200) {
        console.warn(
          `EmbedEZ request error for link: ${preparedUrl} (status code: ${response.status}, body: ${await response.text()})`,
        );
        return [null, null];
      }
      const body = (await response.json()) as { data?: { key?: string } };
      const key = body?.data?.key;
      if (!key) {
        return [null, null];
      }
      return [`https://embedez.com/embed/${key}`, this.staticC.fixerName];
    } catch (err) {
      console.warn(`EmbedEZ request timeout for link: ${preparedUrl}`);
      return [null, null];
    }
  }
}

export class TwitterLink extends GenericWebsiteLink {
  static id = 'twitter';
  static hypertextLabel = 'Tweet';
  static fixDomain = 'fxtwitter.com';
  static fixerName = 'FxTwitter';
  static isTranslation = true;
  static subdomains: Record<string, string> = { normal: '', gallery: 'g.', text_only: 't.', direct_media: 'd.' };
  static routes = generateRoutes(
    ['twitter.com', 'x.com', 'nitter.net', 'xcancel.com', 'nitter.poast.org', 'nitter.privacyredirect.com', 'lightbrd.com', 'nitter.space', 'nitter.tiekoetter.com'],
    {
      '/i/status/:id': null,
      '/:username/status/:id': null,
      '/:username/status/:id/:media_type(photo|video)/:media_id': null,
    },
  );

  getPatchedUrl(domain: string, subdomain = '', postPathSegments = '', replaceAuthor = true): string {
    const repl = replaceAuthor
      ? String(this.repl).replace(/\\g<username>/g, 'i')
      : String(this.repl);
    const formatted = repl
      .replace(/\{domain\}/g, subdomain + domain)
      .replace(/\{post_path_segments\}/g, postPathSegments);
    return expandMatch(this.match!, formatted);
  }

  async getAuthorUrl(): Promise<[string | null, string | null]> {
    const groups = this.match!.groups ?? {};
    if (!('username' in groups) || !groups['username']) {
      return [null, null];
    }
    const username = groups['username'];
    return [`https://${groups['domain']}/${username}`, username];
  }
}

export class InstagramLink extends GenericWebsiteLink {
  static id = 'instagram';
  static hypertextLabel = 'Instagram';
  static fixDomain = 'oginstagram.com';
  static fixerName = 'OGInstagram';
  static routes = generateRoutes('instagram.com', {
    '/:media_type(p|reels?)/:id': ['img_index'],
    '/:username/:media_type(p|reels?)/:id': ['img_index'],
    '/stories/:username/:id': null,
    '/:username': null,
  });

  isValid(): boolean {
    const groups = this.match?.groups ?? {};
    return !!this.match && !('username' in groups && groups['username'] === 'share');
  }
}

export class TikTokLink extends GenericWebsiteLink {
  static id = 'tiktok';
  static hypertextLabel = 'Tiktok';
  static fixDomain = 'tnktok.com';
  static fixerName = 'fxTikTok';
  static subdomains: Record<string, string> = { normal: 'a.', gallery: '', direct_media: 'd.' };
  static routes = generateRoutes('tiktok.com', {
    '/@:username/:media_type(video|photo)/:id': null,
    '/:shortlink_type(t|embed)/:id': null,
    '/:id': null,
  });
}

export class RedditLink extends GenericWebsiteLink {
  static id = 'reddit';
  static hypertextLabel = 'Reddit';
  static fixDomain = 'vxreddit.com';
  static fixerName = 'vxreddit';
  static routes = generateRoutes(['reddit.com', 'redditmedia.com'], {
    '/:post_type(u|r|user)/:username/:type(comments|s)/:id/:slug?': null,
    '/:post_type(u|r|user)/:username/:type(comments|s)/:id/:slug/:comment': null,
    '/:id': null,
  });
}

export class ThreadsLink extends GenericWebsiteLink {
  static id = 'threads';
  static hypertextLabel = 'Threads';
  static fixDomain = 'drhong.ddns.net:9813';
  static isSsl = false;
  static fixerName = 'FixThreads';
  static routes = generateRoutes(['threads.net', 'threads.com'], {
    '/@:username/post/:id': null,
    '/share/:hash': null,
  });
}

export class BlueskyLink extends GenericWebsiteLink {
  static id = 'bluesky';
  static hypertextLabel = 'Bluesky';
  static fixDomain = 'fxbsky.app';
  static fixerName = 'FxBluesky';
  static subdomains: Record<string, string> = { normal: '', direct_media: 'd.', gallery: 'g.', text_only: 't.' };
  static isTranslation = true;
  static routes = generateRoutes('bsky.app', {
    '/profile/did:user_id/post/:id': null,
    '/profile/:username/post/:id': null,
  });
}

export class SnapchatLink extends EmbedEZLink {
  static id = 'snapchat';
  static hypertextLabel = 'Snapchat';
  static routes = generateRoutes('snapchat.com', {
    '/p/:id1/:id2/:id3?': null,
    '/spotlight/:id': null,
    '/@:username/spotlight/:hash': null,
  });
}

export class FacebookLink extends GenericWebsiteLink {
  static id = 'facebook';
  static hypertextLabel = 'Facebook';
  static fixDomain = 'facebed.seria.moe';
  static fixerName = 'facebed';
  static routes = generateRoutes('facebook.com', {
    '/:username/:type(posts|videos)/:slug?/:hash': null,
    '/share/:type(v|r|p)?/:hash': null,
    '/reel/:id': null,
    '/photo': ['fbid'],
    '/photo.php': ['fbid'],
    '/watch': ['v'],
    '/story.php': ['story_fbid', 'id'],
    '/permalink.php': ['story_fbid', 'id'],
    '/groups/:id/:type(posts|permalink)/:hash': null,
    '/groups/:id': ['multi_permalinks'],
  });
}

export class PixivLink extends GenericWebsiteLink {
  static id = 'pixiv';
  static hypertextLabel = 'Pixiv';
  static fixDomain = 'phixiv.net';
  static fixerName = 'phixiv';
  static routes = generateRoutes('pixiv.net', {
    '/member_illust.php': ['illust_id'],
    '/:lang?/artworks/:id/:media?': null,
  });
}

export class TwitchLink extends GenericWebsiteLink {
  static id = 'twitch';
  static hypertextLabel = 'Twitch';
  static fixDomain = 'fxtwitch.seria.moe';
  static fixerName = 'fxtwitch';
  static routes = generateRoutes('twitch.tv', {
    '/:username/clip/:id': null,
  });
}

export class SpotifyLink extends GenericWebsiteLink {
  static id = 'spotify';
  static hypertextLabel = 'Spotify';
  static fixDomain = 'fxspotify.com';
  static fixerName = 'fxspotify';
  static routes = generateRoutes('spotify.com', {
    '/:lang?/track/:id': null,
  });
}

export class DeviantArtLink extends GenericWebsiteLink {
  static id = 'deviantart';
  static hypertextLabel = 'DeviantArt';
  static fixDomain = 'fixdeviantart.com';
  static fixerName = 'fixDeviantArt';
  static routes = generateRoutes('deviantart.com', {
    '/:username/:media_type(art|journal)/:id': null,
  });
}

export class NewgroundsLink extends GenericWebsiteLink {
  static id = 'newgrounds';
  static hypertextLabel = 'Newgrounds';
  static fixDomain = 'fixnewgrounds.com';
  static fixerName = 'FixNewgrounds';
  static routes = generateRoutes('newgrounds.com', {
    '/art/view/:username/:slug': null,
  });

  async getAuthorUrl(): Promise<[string | null, string | null]> {
    const groups = this.match!.groups ?? {};
    if (!('username' in groups)) {
      return [null, null];
    }
    const username = groups['username'];
    return [`https://${username}.newgrounds.com/`, username];
  }
}

export class MastodonLink extends GenericWebsiteLink {
  static id = 'mastodon';
  static hypertextLabel = 'Mastodon';
  static fixDomain = 'fxmas.to';
  static fixerName = 'FxMastodon';
  static routes = generateRoutes(
    ['mastodon.social', 'mstdn.jp', 'mastodon.cloud', 'mstdn.social', 'mastodon.world', 'mastodon.online', 'mas.to', 'techhub.social', 'mastodon.uno', 'infosec.exchange'],
    {
      '/@:username/:id': null,
    },
  );

  async getFixedUrl(): Promise<[string | null, string | null]> {
    const fixedUrl = this.getPatchedUrl(this.staticC.fixDomain + '/\\g<domain>');
    return [fixedUrl, this.staticC.fixerName];
  }
}

export class TumblrLink extends GenericWebsiteLink {
  static id = 'tumblr';
  static hypertextLabel = 'Tumblr';
  static fixDomain = 'tpmblr.com';
  static fixerName = 'fxtumblr';
  static routes = generateRoutes('tumblr.com', {
    '/post/:id/:slug?': null,
    '/:username/:id/:slug?': null,
  });

  async getFixedUrl(): Promise<[string | null, string | null]> {
    const groups = this.match!.groups ?? {};
    let subdomain = '';
    if (groups['subdomain'] && groups['subdomain'] !== 'www') {
      subdomain = '\\g<subdomain>.';
    }
    const fixedUrl = this.getPatchedUrl(this.staticC.fixDomain, subdomain);
    return [fixedUrl, this.staticC.fixerName];
  }

  async getAuthorUrl(): Promise<[string | null, string | null]> {
    const groups = this.match!.groups ?? {};
    const username = 'username' in groups ? groups['username'] : groups['subdomain'];
    if (!username || username === 'www') {
      return [null, null];
    }
    return [`https://${username}.tumblr.com`, username];
  }
}

export class BiliBiliLink extends GenericWebsiteLink {
  static id = 'bilibili';
  static hypertextLabel = 'BiliBili';
  static fixDomain = 'vxbilibili.com';
  static fixerName = 'BiliFix';
  static routes = generateRoutes(['bilibili.com', 'b23.tv', 'b22.top'], {
    '/video/:id': null,
    '/:id': null,
    '/bangumi/play/:id': null,
    '/bangumi/media/:id': null,
    '/bangumi/v2/media-index': ['media_id'],
    '/opus/:id': null,
    '/dynamic/:id': null,
    '/space/:id': null,
    '/detail/:id': null,
    '/m/detail/:id': null,
  });

  async getFixedUrl(): Promise<[string | null, string | null]> {
    const groups = this.match!.groups ?? {};
    let subdomain = '';
    if (groups['subdomain'] && groups['subdomain'] !== 'www' && groups['subdomain'] !== 'm') {
      subdomain = groups['subdomain'] + '.';
    }
    const fixedUrl = this.getPatchedUrl('vx' + groups['domain'], subdomain);
    return [fixedUrl, this.staticC.fixerName];
  }
}

export class IFunnyLink extends EmbedEZLink {
  static id = 'ifunny';
  static hypertextLabel = 'IFunny';
  static routes = generateRoutes('ifunny.co', {
    '/:media_type(video|picture|gif)/:id': null,
  });
}

export class FurAffinityLink extends GenericWebsiteLink {
  static id = 'furaffinity';
  static hypertextLabel = 'Fur Affinity';
  static fixDomain = 'xfuraffinity.net';
  static fixerName = 'xfuraffinity';
  static routes = generateRoutes('furaffinity.net', {
    '/view/:id': null,
  });
}

export class YouTubeLink extends GenericWebsiteLink {
  static id = 'youtube';
  static hypertextLabel = 'YouTube';
  static fixDomain = 'koutube.com';
  static fixerName = 'Koutube';
  static routes = generateRoutes(['youtube.com', 'youtu.be'], {
    '/watch': ['v'],
    '/playlist': ['list'],
    '/shorts/:id': null,
    '/:id': null,
  });
}

export class ImgurLink extends EmbedEZLink {
  static id = 'imgur';
  static hypertextLabel = 'Imgur';
  static routes = generateRoutes('imgur.com', {
    '/gallery/:slug_hash': null,
    '/:hash': null,
  });
}

export class WeiboLink extends EmbedEZLink {
  static id = 'weibo';
  static hypertextLabel = 'Weibo';
  static routes = generateRoutes(['weibo.com', 'weibo.cn'], {
    '/:id/:hash': null,
  });
}

export class GelbooruLink extends EmbedEZLink {
  static id = 'imageboards';
  static isTranslation = false;
  static routes = generateRoutes(
    ['rule34.xxx', 'gelbooru.com', 'safebooru.org', 'realbooru.com', 'hypnohub.net', 'xbooru.com', 'tbib.org'],
    {
      '/index.php': ['page', 's', 'id'],
    },
  );

  label(): string {
    const domain = this.match!.groups?.['domain'];
    if (domain === 'rule34.xxx') {
      return 'Rule34.xxx';
    }
    return domain ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1) : 'Gelbooru';
  }
}

export class DanbooruLink extends EmbedEZLink {
  static id = 'imageboards';
  static isTranslation = false;
  static hypertextLabel = 'Danbooru';
  static routes = generateRoutes(['danbooru.donmai.us'], {
    '/posts/:id': null,
  });
}

export class E621ngLink extends EmbedEZLink {
  static id = 'imageboards';
  static isTranslation = false;
  static routes = generateRoutes(['e621.net', 'e926.net'], {
    '/posts/:id': null,
  });

  label(): string {
    const domain = this.match!.groups?.['domain'];
    return domain ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1) : 'e621';
  }
}

export class MoebooruLink extends EmbedEZLink {
  static id = 'imageboards';
  static isTranslation = false;
  static routes = generateRoutes(['konachan.com', 'konachan.net', 'yande.re'], {
    '/post/show/:id/:slug?': null,
  });

  label(): string {
    const domain = this.match!.groups?.['domain'];
    if (domain === 'yande.re') {
      return 'Yande.re';
    }
    return domain ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1) : 'Moebooru';
  }
}

export class PhilomenaLink extends EmbedEZLink {
  static id = 'imageboards';
  static isTranslation = false;
  static hypertextLabel = 'Derpibooru';
  static routes = generateRoutes(['derpibooru.org'], {
    '/images/:id': null,
  });
}

export class ShimieLink extends EmbedEZLink {
  static id = 'imageboards';
  static isTranslation = false;
  static hypertextLabel = 'Rule34';
  static routes = generateRoutes(['rule34.paheal.net'], {
    '/post/view/:id': null,
  });
}

export class PinterestLink extends EmbedEZLink {
  static id = 'pinterest';
  static hypertextLabel = 'Pinterest';
  static routes = generateRoutes(['pinterest.com', 'pin.it'], {
    '/pin/:id': null,
    '/:hash': null,
  });
}

export class CustomLink extends WebsiteLink {
  static id = 'custom';

  fixedLink: string | null = null;
  hypertextLabel: string | null = null;
  fixerDomain: string | null = null;

  constructor(guild: Guild, url: string, spoiler = false) {
    super(guild, url, spoiler);
    const customWebsites = CustomWebsite.findAllByGuild(guild.id);
    for (const website of customWebsites) {
      const match = new RegExp(
        `https?://(?:www\\.)?(${escapeRe(website.domain)})/(.+)`,
        'i',
      ).exec(url);
      if (match) {
        this.fixedLink = `https://${website.fix_domain}/${match[2]}`;
        this.hypertextLabel = website.name;
        this.fixerDomain = website.fix_domain;
      }
    }
  }

  static ifValid(guild: Guild, url: string, spoiler = false): CustomLink | null {
    if (CustomWebsite.findAllByGuild(guild.id).length === 0) {
      return null;
    }
    const self = new CustomLink(guild, url, spoiler);
    return self.isValid() ? self : null;
  }

  isValid(): boolean {
    return this.fixedLink !== null;
  }

  async getFixedUrl(): Promise<[string | null, string | null]> {
    if (!this.fixedLink) {
      return [null, null];
    }
    let fixerName = this.fixerDomain!;
    fixerName = fixerName.split('/')[0];
    const elements = fixerName.split('.');
    fixerName = elements.length > 1 ? elements.slice(0, -1).join('.') : elements[0];
    fixerName = fixerName.charAt(0).toUpperCase() + fixerName.slice(1);
    return [this.fixedLink, fixerName];
  }

  async getAuthorUrl(): Promise<[string | null, string | null]> {
    return [null, null];
  }

  async getOriginalUrl(): Promise<[string | null, string | null]> {
    return [this.url, this.hypertextLabel];
  }
}

export const websites: Array<typeof GenericWebsiteLink | typeof CustomLink> = [
  TwitterLink,
  InstagramLink,
  TikTokLink,
  RedditLink,
  ThreadsLink,
  BlueskyLink,
  SnapchatLink,
  FacebookLink,
  PinterestLink,
  PixivLink,
  TwitchLink,
  SpotifyLink,
  DeviantArtLink,
  NewgroundsLink,
  MastodonLink,
  TumblrLink,
  BiliBiliLink,
  IFunnyLink,
  YouTubeLink,
  ImgurLink,
  WeiboLink,
  FurAffinityLink,
  GelbooruLink,
  DanbooruLink,
  E621ngLink,
  MoebooruLink,
  PhilomenaLink,
  ShimieLink,
  CustomLink,
];