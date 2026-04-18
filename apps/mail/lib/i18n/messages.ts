import ar from '@/messages/ar.json';
import ca from '@/messages/ca.json';
import cs from '@/messages/cs.json';
import de from '@/messages/de.json';
import en from '@/messages/en.json';
import es from '@/messages/es.json';
import fa from '@/messages/fa.json';
import fr from '@/messages/fr.json';
import hi from '@/messages/hi.json';
import hu from '@/messages/hu.json';
import ja from '@/messages/ja.json';
import ko from '@/messages/ko.json';
import lv from '@/messages/lv.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import pt from '@/messages/pt.json';
import ru from '@/messages/ru.json';
import tr from '@/messages/tr.json';
import vi from '@/messages/vi.json';
import { getLocale, type Locale } from './runtime';

type MessageDict = Record<string, unknown>;

const dictionaries: Record<Locale, MessageDict> = {
  en: en as MessageDict,
  ar: ar as MessageDict,
  ca: ca as MessageDict,
  cs: cs as MessageDict,
  de: de as MessageDict,
  es: es as MessageDict,
  fr: fr as MessageDict,
  hi: hi as MessageDict,
  nl: nl as MessageDict,
  ja: ja as MessageDict,
  ko: ko as MessageDict,
  lv: lv as MessageDict,
  pl: pl as MessageDict,
  pt: pt as MessageDict,
  ru: ru as MessageDict,
  tr: tr as MessageDict,
  hu: hu as MessageDict,
  fa: fa as MessageDict,
  vi: vi as MessageDict,
};

const resolvedMessageCache = new Map<string, unknown>();

const lookup = (dict: MessageDict, key: string): unknown => {
  const path = key.split('.');
  let current: unknown = dict;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const interpolate = (template: string, args?: Record<string, unknown>) =>
  template.replace(/\{([^}]+)\}/g, (_, k) => String(args?.[k] ?? ''));

const resolveMessage = (key: string, args?: Record<string, unknown>) => {
  const locale = getLocale();
  const cacheKey = `${locale}:${key}`;
  const currentDict = dictionaries[locale] || dictionaries.en;
  const cached = resolvedMessageCache.get(cacheKey);
  const value =
    cached !== undefined ? cached : (lookup(currentDict, key) ?? lookup(dictionaries.en, key));
  if (cached === undefined) resolvedMessageCache.set(cacheKey, value);

  if (typeof value === 'string') return interpolate(value, args);
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') return interpolate(first, args);
    if (typeof first === 'object' && first && 'match' in first) {
      const matches = (first as { match?: Record<string, string> }).match;
      const picked = matches ? Object.values(matches)[0] : undefined;
      if (picked) return interpolate(picked, args);
    }
  }

  return key;
};

type MessageFn = ((args?: Record<string, unknown>) => string) & {
  rich: (args?: Record<string, unknown>) => string;
};

export const m = new Proxy({} as Record<string, MessageFn>, {
  get(_, prop: string) {
    const fn = ((args?: Record<string, unknown>) => resolveMessage(prop, args)) as MessageFn;
    fn.rich = (args?: Record<string, unknown>) => resolveMessage(prop, args);
    return fn;
  },
});
