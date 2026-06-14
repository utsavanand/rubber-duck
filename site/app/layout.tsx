import type { Metadata } from "next";
import "./globals.css";

const TITLE = "RubberDuckHQ: headquarters for your team of agents";
const DESCRIPTION =
  "Run many AI coding agents at once. RubberDuckHQ launches them into isolated git worktrees, shows what each is doing, and surfaces the one that needs you. Local-first; your code never leaves your machine.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Rich preview when the site link is shared (Slack, Twitter, etc.).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary",
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
