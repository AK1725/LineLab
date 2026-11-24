import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer, MainNav } from "../src/i18n/main-nav";
import { RegisterServiceWorker } from "../src/lib/register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LineLab", template: "%s · LineLab" },
  description: "Design, wire, simulate and debug line-following robots.",
  applicationName: "LineLab",
};

export const viewport: Viewport = { themeColor: "#0f9d74" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-border">
          <MainNav />
        </header>
        {children}
        <Footer />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
