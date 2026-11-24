"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "../i18n/use-t";
import { useSession } from "./session";

export function UserMenu() {
  const { user, status, load, signOut } = useSession();
  const t = useT();
  useEffect(() => {
    void load();
  }, [load]);
  if (status !== "ready") return null;
  return user ? (
    <span className="ml-auto flex items-center gap-3 text-sm">
      <span className="text-muted">{user.name}</span>
      <button className="text-muted underline hover:text-fg" onClick={() => void signOut()}>
        {t("nav.signOut")}
      </button>
    </span>
  ) : (
    <Link href="/signin" className="ml-auto text-sm text-muted hover:text-fg">
      {t("nav.signIn")}
    </Link>
  );
}
