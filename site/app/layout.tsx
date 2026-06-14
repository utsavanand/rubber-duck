import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RubberDuckHQ: headquarters for your team of agents",
  description:
    "Run many AI coding agents at once. RubberDuckHQ launches them into isolated git worktrees, shows what each is doing, and surfaces the one that needs you. Local-first; your code never leaves your machine.",
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
