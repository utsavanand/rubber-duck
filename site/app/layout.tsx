import type { Metadata } from "next";
import "./globals.css";

const TITLE = "RubberDuckHQ: headquarters for your team of agents";
const DESCRIPTION =
  "Run many AI coding agents at once. RubberDuckHQ launches them into isolated git worktrees, shows what each is doing, and surfaces the one that needs you. Local-first; your code never leaves your machine.";

// Absolute base so the auto-generated og:image (app/opengraph-image.tsx) resolves
// for scrapers. On Vercel this comes from the deploy env; falls back to localhost.
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3001";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  // Rich preview when the site link is shared (Slack, Twitter, etc.).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
