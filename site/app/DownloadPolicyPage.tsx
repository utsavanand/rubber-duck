import type { ReactNode } from "react";
import DownloadPolicyLinks from "./DownloadPolicyLinks";
import "./editions.css";
import "./download-policy.css";

export default function DownloadPolicyPage({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ed-page">
    <a className="ed-skip" href="#policy">Skip to content</a>
    <header className="ed-nav ed-width">
      <div className="ed-brand-group"><a href="/" className="ed-brand"><img src="/duckmark.svg" width="25" height="25" alt=""/>DuckTerm</a><a className="ed-maker" href="https://utsava.xyz">Made by Utsav</a></div>
      <a className="policy-nav-link" href="/">Back to downloads ↗</a>
    </header>
    <main id="policy" className="ed-width policy-main"><article>
      <h1>{title}</h1>
      <div className="policy-date">Last updated: November 1, 2026</div>
      {children}
    </article></main>
    <footer className="ed-width ed-footer"><a href="/" className="ed-brand"><img src="/duckmark.svg" width="25" height="25" alt=""/>DuckTerm</a><p className="policy-footer-copy">Source available · <a href="https://github.com/utsavanand/duckterm/blob/main/LICENSE">FSL-1.1-MIT</a><br/>Becomes MIT after two years.<DownloadPolicyLinks/></p></footer>
  </div>;
}
