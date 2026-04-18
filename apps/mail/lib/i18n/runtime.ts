import { I18N_LOCALE_COOKIE_NAME } from '@/lib/constants';

export type Locale =
  | 'en'
  | 'ar'
  | 'ca'
  | 'cs'
  | 'de'
  | 'es'
  | 'fr'
  | 'hi'
  | 'nl'
  | 'ja'
  | 'ko'
  | 'lv'
  | 'pl'
  | 'pt'
  | 'ru'
  | 'tr'
  | 'hu'
  | 'fa'
  | 'vi';

const DEFAULT_LOCALE: Locale = 'en';

let activeLocale: Locale = DEFAULT_LOCALE;

export const getLocale = (): Locale => {
  if (typeof document === 'undefined') return activeLocale;

  const fromCookie = document.cookie
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${I18N_LOCALE_COOKIE_NAME}=`))
    ?.split('=')[1] as Locale | undefined;

  if (fromCookie) return fromCookie;
  return activeLocale;
};

export const setLocale = (locale: Locale) => {
  activeLocale = locale;
  if (typeof document !== 'undefined') {
    document.cookie = `${I18N_LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }
};
