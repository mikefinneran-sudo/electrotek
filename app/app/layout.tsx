import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import "./globals.css";
import clientConfig from "../client.config";
import { staffLoginLink } from "@waltersignal/bananaforce-core";
import { brandThemeVars } from "../lib/brand-theme";

// Self-hosted (WAL-679): next/font/google fetches this file from Google Fonts
// at build time, which made CI builds flaky whenever that network call
// failed. IBM Plex Sans latin ships as one variable font covering the whole
// wght axis, so the single file below replaces the 400/500/600 static
// requests with no runtime difference.
const bodyFont = localFont({
  src: "./fonts/ibm-plex-sans-latin.woff2",
  weight: "400 600",
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  // The client's own name, not the platform's. This app is ElectroTek's; the
  // vendor's product name and marketing copy do not belong in their tab or in
  // a link preview they send to a carrier.
  title: `${clientConfig.brand.name}`,
  description: `Staff workspace for ${clientConfig.brand.name}.`,
};

const loginLink = staffLoginLink(clientConfig);


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={bodyFont.variable}>
      <body style={brandThemeVars(clientConfig.brand)}>
        <div className="app-frame">
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="topbar-brand">
                <span className="topbar-mark" aria-hidden>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                  </svg>
                </span>
                <span className="topbar-name">{clientConfig.brand.name}</span>
              </Link>

              <div className="topbar-actions">
                {loginLink ? (
                  <Link href={loginLink.href} className="btn btn-sm">
                    {loginLink.label}
                  </Link>
                ) : null}
              </div>
            </div>
          </header>

          <div className="app-main">{children}</div>

          <footer className="app-footer">
            <div className="topbar-inner app-footer-inner">
              <span>{clientConfig.brand.name}</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
