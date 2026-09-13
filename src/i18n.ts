import enUS from './locales/en-US.json';
import fr from './locales/fr.json';

export const DEFAULT_LOCALE = 'en-US';

type LocaleData = Record<string, string>;

export const locales: Record<string, LocaleData> = { enUS: enUS, fr: fr };

function getLocale(locale: string): LocaleData {
  return locales[locale.replace('-', '')] ?? locales['enUS'];
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