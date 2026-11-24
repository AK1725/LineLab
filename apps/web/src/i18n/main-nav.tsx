"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "../gallery/user-menu";
import { LOCALES, type Locale } from "./messages";
import { useLocale, useRestoreLocale, useT } from "./use-t";

const LINKS = [
  ["/build", "nav.build"],
  ["/tracks", "nav.tracks"],
  ["/components", "nav.components"],
  ["/gallery", "nav.gallery"],
  ["/learn", "nav.learn"],
] as const;

export function MainNav() {
  useRestoreLocale();
  const t = useT();
  return (
    <nav
      aria-label="Main"
      className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 sm:px-6"
    >
      <Link href="/" className="font-semibold tracking-tight">
        LineLab
      </Link>
      {LINKS.map(([href, key]) => (
        <Link key={href} href={href} className="text-sm text-muted hover:text-fg">
          {t(key)}
        </Link>
      ))}
      <UserMenu />
    </nav>
  );
}

export function Footer() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  // The editor fills the window; no footer under it.
  if (usePathname().startsWith("/build/edit")) return null;
  return (
    <footer className="mx-auto mt-16 flex max-w-5xl flex-wrap items-center gap-4 border-t border-border px-4 py-6 text-sm text-muted sm:px-6">
      <span>{t("footer.offline")}</span>
      <label className="ml-auto flex items-center gap-2">
        {t("footer.language")}
        <select
          value={locale}
          onChange={(e) => {
            setLocale(e.target.value as Locale);
          }}
          className="rounded-md border border-border bg-bg px-1 py-0.5 text-fg"
        >
          {Object.entries(LOCALES).map(([k, name]) => (
            <option key={k} value={k}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
