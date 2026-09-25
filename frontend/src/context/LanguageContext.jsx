import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import en from '../lang/en.js';
import hi from '../lang/hi.js';

const STRINGS = { en, hi };
const STORAGE_KEY = 'psq_lang';
const LanguageContext = createContext(null);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'hi' || v === 'en' ? v : 'en';
  } catch {
    return 'en';
  }
}

/** `forceLang` pins the language for a subtree (the admin panel is English only). */
export function LanguageProvider({ children, forceLang }) {
  const [storedLang, setLangState] = useState(readStored);
  const lang = forceLang || storedLang;

  const setLang = useCallback((next) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    if (!forceLang) document.documentElement.lang = lang;
  }, [lang, forceLang]);

  /** Translate a UI key, interpolating {placeholders}. */
  const t = useCallback(
    (key, vars = {}) => {
      const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
      return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
    },
    [lang],
  );

  /** Pick bilingual content: Hindi when selected and available, else English. */
  const pick = useCallback((enText, hiText) => (lang === 'hi' && hiText ? hiText : enText), [lang]);

  const formatDate = useCallback(
    (value, withTime = false) => {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value || '';
      return d.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      });
    },
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, pick, formatDate }}>{children}</LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}

/** Format a date in a fixed language (used where both languages are shown at once). */
export function formatDateIn(lang, value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value || '';
  return d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function translateIn(lang, key, vars = {}) {
  const s = STRINGS[lang][key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}
