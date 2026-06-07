import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rubberduck — one window over your fleet of AI coding agents",
  description:
    "Local-first orchestrator for AI coding agents. Launch them into isolated git worktrees, see which one needs you, fork any session, and keep durable history with intent → outcome summaries.",
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
