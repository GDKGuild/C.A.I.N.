import config from '../config.json';
import packageJson from '../package.json';

export const VERSION: string = packageJson.version;
export const COLOR: number = config.color;

export const EMOJI: Record<string, string> = config.emoji;

export const LINKS: Record<string, string> = {
  invite: config.invite_link,
  repo: config.repo_link,
  original: config.original_link,
  support: config.support_link,
  credits: config.original_link,
};

export const TOKEN: string = process.env.DISCORD_TOKEN ?? '';