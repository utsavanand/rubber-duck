import type { Metadata } from "next";
import "./globals.css";
const title = "DuckTerm — One place for your coding agents";
const description = "Run Claude Code, Codex, and other coding agents side by side. Keep terminals, conversations, and project context together in DuckTerm.";
export const metadata: Metadata = {
  metadataBase: new URL("https://duckterm.utsava.xyz"),
  title, description, alternates: { canonical: "/" },
  openGraph: { title, description, type: "website", url: "https://duckterm.utsava.xyz", siteName: "DuckTerm" },
  twitter: { card: "summary_large_image", title, description },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
