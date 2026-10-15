import enUS from './locales/en-US.json';
import enGB from './locales/en-GB.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import id from './locales/id.json';
import ja from './locales/ja.json';
import ms from './locales/ms.json';
import th from './locales/th.json';
import thLatn from './locales/th-Latn.json';
import zhCN from './locales/zh-CN.json';
import zhCNLatn from './locales/zh-CN-Latn.json';
import zhTW from './locales/zh-TW.json';
import zhTWLatn from './locales/zh-TW-Latn.json';
import type { Guild } from './db';

export const DEFAULT_LOCALE = 'en-US';

export const SUPPORTED_LOCALES: Array<{ code: string; name: string }> = [
  { code: 'en-US', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ja', name: '日本語' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'th', name: 'ไทย' },
  { code: 'zh-CN', name: '中文 (简体)' },
  { code: 'zh-TW', name: '中文 (繁體)' },
];

type LocaleData = Record<string, string>;

export const locales: Record<string, LocaleData> = {
  enUS: enUS,
  enGB: enGB,
  fr: fr,
  de: de,
  id: id,
  ja: ja,
  ms: ms,
  th: th,
  thLatn: thLatn,
  zhCN: zhCN,
  zhCNLatn: zhCNLatn,
  zhTW: zhTW,
  zhTWLatn: zhTWLatn,
};

const localeKey = (code: string): string => code.replace(/-/g, '');

function getLocale(locale: string): LocaleData {
  const key = localeKey(locale);
  if (locales[key]) return locales[key];
  const lang = locale.split('-')[0].toLowerCase();
  const match =
    Object.keys(locales).find((k) => k.toLowerCase() === lang) ??
    Object.keys(locales).find((k) => k.toLowerCase().startsWith(lang));
  return match ? locales[match] : locales['enUS'];
}

export function resolveLocale(guild: Guild | null | undefined, interactionLocale?: string | null): string {
  const override = guild?.ui_language;
  if (override && locales[localeKey(override)]) return override;
  return interactionLocale || DEFAULT_LOCALE;
}

export function t(
  key: string,
  kwargs: Record<string, unknown> = {},
  locale: string = DEFAULT_LOCALE,
): string {
  let value = getLocale(locale)[key];
  if (value === undefined && locale !== DEFAULT_LOCALE) value = locales['enUS'][key];
  if (value === undefined) {
    return 'default' in kwargs ? String(kwargs['default']) : key;
  }
  return objectFormat(value, kwargs);
}

export function objectFormat(object: string, kwargs: Record<string, unknown>): string {
  return object.replace(/%\{(\w+)\}/g, (_, name) => {
    const v = kwargs[name];
    return v === undefined || v === null ? '' : String(v);
  });
}