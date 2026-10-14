import enUS from './locales/en-US.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ms from './locales/ms.json';
import th from './locales/th.json';
import thLatn from './locales/th-Latn.json';
import type { Guild } from './db';

export const DEFAULT_LOCALE = 'en-US';

export const SUPPORTED_LOCALES: Array<{ code: string; name: string }> = [
  { code: 'en-US', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'th', name: 'ไทย' },
];

type LocaleData = Record<string, string>;

export const locales: Record<string, LocaleData> = { enUS: enUS, fr: fr, de: de, ms: ms, th: th, thLatn: thLatn };

const localeKey = (code: string): string => code.replace('-', '');

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