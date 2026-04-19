import React from 'react';
import { messages } from './messages';
import { I18nContextValue, LOCALE_STORAGE_KEY, Locale, MessageKey, TranslationParams, isLocale } from './types';

interface I18nProviderProps {
  children: React.ReactNode;
  initialLocale?: Locale;
}

export const I18nContext = React.createContext<I18nContextValue | null>(null);

function getSavedLocale(): Locale | null {
  try {
    const savedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(savedLocale) ? savedLocale : null;
  } catch {
    return null;
  }
}

function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function resolveLocale(initialLocale?: Locale): Locale {
  if (initialLocale) {
    return initialLocale;
  }

  if (typeof window === 'undefined') {
    return 'en';
  }

  const savedLocale = getSavedLocale();
  if (savedLocale) {
    return savedLocale;
  }

  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function translate(locale: Locale, key: MessageKey, params?: TranslationParams): string {
  const template = messages[locale][key];

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value == null ? `{${name}}` : String(value);
  });
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = React.useState<Locale>(() => resolveLocale(initialLocale));

  const setLocale = React.useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    persistLocale(nextLocale);
  }, []);

  const t = React.useCallback((key: MessageKey, params?: TranslationParams) => {
    return translate(locale, key, params);
  }, [locale]);

  const value = React.useMemo(() => {
    return { locale, setLocale, t };
  }, [locale, setLocale, t]);

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.title = messages[locale]['page.title'];
  }, [locale]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
