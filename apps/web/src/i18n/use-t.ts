"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { en, LOCALES, MESSAGES, type Locale, type MessageKey } from "./messages";

const KEY = "ll_locale";

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

/** The UI locale: English on the server and first paint, then the visitor's saved choice. */
export const useLocale = create<LocaleState>()((set) => ({
  locale: "en",
  setLocale: (locale) => {
    set({ locale });
    try {
      localStorage.setItem(KEY, locale);
    } catch {
      // not remembered
    }
    document.documentElement.lang = locale;
  },
}));

/** Restores the saved locale once (call from one always-mounted component). */
export function useRestoreLocale() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && saved in LOCALES && saved !== "en")
        useLocale.getState().setLocale(saved as Locale);
    } catch {
      // stay in English
    }
  }, []);
}

export function useT() {
  const locale = useLocale((s) => s.locale);
  return (key: MessageKey): string => MESSAGES[locale][key] ?? en[key];
}
