import config from '../config.json';
import packageJson from '../package.json';

export const VERSION: string = packageJson.version;
export const COLOR: number = config.color;

export const EMOJI: Record<string, string> = config.emoji;

export const LINKS: Record<string, string> = {
  invite: config.invite_link,
  user_install: config.user_install_link,
  repo: config.repo_link,
  original: config.original_link,
  support: config.support_link,
  credits: config.original_link,
};

export const TOKEN: string = process.env.DISCORD_TOKEN ?? '';

export const BOT_OWNER_IDS: Set<string> = new Set(
  (process.env.BOT_OWNER_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

export const KEEP_PROMPT_THRESHOLD: number = parseInt(process.env.KEEP_PROMPT_THRESHOLD ?? '5', 10);
export const KEEP_IGNORE_THRESHOLD: number = parseInt(process.env.KEEP_IGNORE_THRESHOLD ?? '5', 10);