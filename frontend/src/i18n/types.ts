export type Locale = 'zh-CN' | 'en';

export const LOCALE_STORAGE_KEY = 'fzfetch.locale';

export const messageKeys = [
  'page.title',
  'search.placeholder',
  'empty.waiting',
  'empty.searching',
  'empty.noMatches',
  'empty.indexRefreshing',
  'empty.indexPending',
  'hint.selectItem',
  'hint.download',
  'hint.clear',
  'status.connecting',
  'status.disconnected',
  'status.error',
  'status.indexPending',
  'status.indexRefreshing',
  'status.indexUnknown',
  'status.indexReady',
  'work.idle',
  'work.searching',
  'work.scanning',
  'toast.downloadStarted',
  'toast.downloadFailed',
  'toast.fileGone',
  'locale.switchToEnglish',
  'locale.switchToChinese',
  'locale.labelChinese',
  'locale.labelEnglish',
  'toast.dismiss',
] as const;

export type MessageKey = (typeof messageKeys)[number];

export type TranslationParams = Record<string, string | number>;

export type MessageCatalog = Record<MessageKey, string>;

export type Translate = (key: MessageKey, params?: TranslationParams) => string;

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'zh-CN' || value === 'en';
}
