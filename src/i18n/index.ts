import en from './locales/en';
import ja from './locales/ja';
import zhCN, { type MessageKey } from './locales/zh-CN';
import zhTW from './locales/zh-TW';

export type { MessageKey };

export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja';

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

const dicts: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en,
  ja,
};

export function normalizeLocale(locale: string | undefined | null): Locale {
  if (locale && locale in dicts) return locale as Locale;
  return DEFAULT_LOCALE;
}

export function t(locale: Locale, key: MessageKey): string {
  return dicts[locale][key];
}
