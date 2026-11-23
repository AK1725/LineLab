import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LineLab", template: "%s · LineLab" },
  description: "Design, wire, simulate and debug line-following robots.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-border">
          <nav
            aria-label="Main"
            className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 sm:px-6"
          >
            <Link href="/" className="font-semibold tracking-tight">
              LineLab
            </Link>
            <Link href="/components" className="text-sm text-muted hover:text-fg">
              Components
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
