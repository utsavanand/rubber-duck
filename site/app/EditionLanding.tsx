"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import DemoPlayback from "./DemoPlayback";
import DuckScene from "./DuckScene";
import "./editions.css";

type EditionId = "lite" | "code" | "full";
type Edition = { id: EditionId; name: string; short: string; purpose: string; lead: string; description: string; scope: string; availability: string; bars: [string, string][] };
const editions: Edition[] = [
  { id: "lite", name: "DuckTerm Lite", short: "Lite", purpose: "Sessions", lead: "Run coding agents side by side.", description: "Organize sessions in folders and workstreams. Use terminal layouts, Shell, Messages, session status, and supported forks with your installed coding agents.", scope: "Desktop", availability: "Public download", bars: [["Work", "Terminal / Shell / Messages"], ["Organize", "Folders / Workstreams"], ["Branch out", "Native forks / Custom commands"]] },
  { id: "code", name: "DuckTerm Code", short: "Code", purpose: "Code review", lead: "Review files, changes, and pull requests.", description: "Lite’s session tools, plus files, Git, checkpoints, handoff, and the PR review platform.", scope: "Desktop", availability: "Invite-only · public availability to be announced", bars: [["Inspect", "File explorer / Editing / Git"], ["Continue", "Checkpoints / Context / Handoff"], ["Review", "PR review platform"]] },
  { id: "full", name: "DuckTerm Full", short: "Full", purpose: "Agent fleet", lead: "Monitor agents across local and remote workspaces.", description: "Everything in Code, including PR review, plus Oracle, remote workspace management, and Artifacts.", scope: "Desktop", availability: "Invite-only · public availability to be announced", bars: [["See", "Oracle"], ["Run", "Remote workspaces"], ["Keep", "Artifacts"]] },
];
const rows = [
  { name: "Files, Git, checkpoints & handoff", cells: ["no", "yes", "yes"] },
  { name: "Inbox, folder chats & connectors", cells: ["no", "yes", "yes"] },
  { name: "PR review platform", cells: ["no", "yes", "yes"] },
  { name: "Oracle, remote workspaces & Artifacts", cells: ["no", "no", "yes"] },
];

// Pin the bundled Lite asset so installation instructions match this download.
const liteDownload = "https://github.com/utsavanand/duckterm/releases/download/v0.4.182/DuckTerm-Lite-0.4.182-macos-arm64.zip";
const installationGuide = "https://github.com/utsavanand/duckterm#install";

function Mark({ value }: { value: string }) {
  if (value === "yes") return <span className="ed-check"><span aria-hidden="true">✓</span><span className="ed-sr">Included</span></span>;
  if (value === "no") return <span className="ed-no"><span aria-hidden="true">—</span><span className="ed-sr">Not included</span></span>;
  return <span className="ed-cell-text">{value}</span>;
}

export default function EditionLanding() {
  const [selected, setSelected] = useState<EditionId>("lite");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const read = () => { const id = window.location.hash.slice(1); if (editions.some(item => item.id === id)) setSelected(id as EditionId); };
    read(); window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const choose = (id: EditionId) => { setSelected(id); history.replaceState(null, "", `#${id}`); };
  const keydown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % editions.length;
    else if (event.key === "ArrowLeft") next = (index + editions.length - 1) % editions.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = editions.length - 1;
    else return;
    event.preventDefault(); choose(editions[next].id); tabs.current[next]?.focus();
  };
  return <div className="ed-page">
    <a className="ed-skip" href="#edition-content">Skip to edition details</a>
    <header className="ed-nav ed-width">
      <div className="ed-brand-group"><a href="#lite" className="ed-brand" aria-label="DuckTerm home" onClick={event => { event.preventDefault(); choose("lite"); window.scrollTo({top:0}); }}><img src="/duckmark.svg" alt="" width="25" height="25"/>DuckTerm</a><a className="ed-maker" href="https://utsava.xyz">Made by Utsav</a></div>
      <div className="ed-nav-links"><a href="#compare">Compare</a><a href="#ducky">Ducky<span className="ed-nav-detail"> for iPhone</span></a><a href="https://github.com/utsavanand/duckterm#readme">Docs ↗</a><a href="https://github.com/utsavanand/duckterm">GitHub ↗</a></div>
    </header>
    <main>
      <section className="ed-width ed-top" aria-label="DuckTerm editions">
        <p className="ed-motto">Your software factory, on Open Stack, <span>with autonomy on a dial.</span></p>
        <div className="ed-edition-heading">Desktop editions</div>
        <div className="ed-selector" role="tablist" aria-label="Choose a desktop edition">
          {editions.map((item, index) => <button key={item.id} ref={el => { tabs.current[index] = el; }} type="button" id={`tab-${item.id}`} role="tab" aria-selected={selected === item.id} aria-controls={`panel-${item.id}`} tabIndex={selected === item.id ? 0 : -1} onClick={() => choose(item.id)} onKeyDown={event => keydown(event, index)}><span className="ed-tab-name">{item.short}</span><span className="ed-tab-purpose">{item.purpose}</span></button>)}
        </div>
        <div id="edition-content" tabIndex={-1}>
          {editions.map(item => <div key={item.id} id={`panel-${item.id}`} role="tabpanel" aria-labelledby={`tab-${item.id}`} hidden={selected !== item.id} className="ed-edition-panel">
            <div className="ed-intro">
              <p className="ed-kicker">{item.scope} <span>/</span> {item.purpose}</p>
              <h1>{item.name}</h1>
              <p className="ed-lead">{item.lead}</p>
              <p className="ed-description">{item.description}</p>
              <div className="ed-action-area">
                {item.id === "lite" ? <>
                  <a className="ed-primary" href={liteDownload} aria-describedby="lite-download-note">Download for Mac <span aria-hidden="true">↙</span></a>
                  <p id="lite-download-note" className="ed-availability">macOS 13+ · Apple silicon<br/>Download, unzip, open. <a href="#install">Installation steps</a></p>
                </> : <p className="ed-availability ed-invite"><span className="ed-status-dot"/>{item.availability}</p>}
              </div>
              {item.id !== "lite" && <p className="ed-ai-note">By default, AI analysis uses your installed coding harness, such as Claude Code or Codex, and its existing login. Responses may take a little longer.</p>}
            </div>
            <DuckScene/>
          </div>)}
        </div>
      </section>
      <section className="ed-width ed-demo-section" id="demo" aria-labelledby="demo-title">
        <div className="ed-section-head"><h2 id="demo-title">The app in use.</h2><p>A recorded workflow in the current desktop app.</p></div>
        <div id="animated-demo" className="ed-demo">
          <video id="demo-video" muted loop playsInline preload="metadata" poster="/duckterm-dashboard-poster.jpg" aria-label="DuckTerm dashboard recording with fictional demo sessions"><source src="/duckterm-dashboard.mp4" type="video/mp4"/>Your browser does not support this recording.</video>
          <div className="ed-video-progress" aria-hidden="true"><div id="video-progress"/></div>
          <div className="ed-video-controls"><span id="demo-step">Sessions grouped in folders</span><button id="demo-pause" type="button">Play</button><button id="demo-replay" type="button">Replay</button><button id="demo-expand" type="button">Full screen ↗</button></div>
        </div>
        <p className="ed-demo-caption">Real app recording. Fictional projects and messages. Available tools vary by edition.</p>
      </section>
      <section className="ed-width ed-comparison" id="compare" aria-labelledby="compare-title">
        <div className="ed-section-head"><h2 id="compare-title">Compare desktop editions</h2></div>
        <div className="ed-foundation"><p>In every desktop edition</p><div><span>Terminal, Shell &amp; Messages</span><span>Folders &amp; workstreams</span><span>Installed harnesses &amp; custom commands</span><span>Supported session forks / Status</span></div></div>
        <div className="ed-table-wrap">
          <table className="ed-table"><caption className="ed-sr">Additional features available in Lite, Code and Full. A checkmark means included; a dash means not included.</caption>
            <colgroup><col className="ed-feature-col"/>{editions.map(item => <col key={item.id} className={selected === item.id ? "ed-col-selected" : ""}/>)}</colgroup>
            <thead><tr><th scope="col">Capabilities</th>{editions.map(item => <th scope="col" key={item.id} data-selected={selected === item.id}><button type="button" onClick={() => { choose(item.id); const content = document.getElementById("edition-content"); content?.focus({preventScroll:true}); content?.scrollIntoView({block:"start"}); }}>{item.short}<span className="ed-sr"> edition details</span></button></th>)}</tr></thead>
            <tbody>{rows.map(row => <tr key={row.name}><th scope="row">{row.name}</th>{row.cells.map((value,index) => <td key={index}><Mark value={value}/></td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="ed-compare-notes"><p><strong>Code / Full</strong> PR review is included in Code and Full.</p></div>
      </section>
      <section className="ed-width ed-companion" id="ducky" aria-labelledby="ducky-title">
        <div className="ed-companion-identity">
          <svg className="ed-phone" width="56" height="82" viewBox="0 0 56 82" fill="none" aria-hidden="true"><rect x="7" y="3" width="42" height="76" rx="9" stroke="currentColor" strokeWidth="2"/><path d="M23 10h10M22 72h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="m20 40 6 6 11-13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <div><p className="ed-kicker">iPhone companion</p><h2 id="ducky-title">Ducky</h2><p className="ed-availability">Invite-only · not yet available</p></div>
        </div>
        <div className="ed-companion-copy"><p>Check your agents from your iPhone.</p><p>Browse folders and check observed agent status while the app is open.</p><p className="ed-companion-note">Read-only, with foreground refresh and stale or offline status identified. No background push notifications, replies, or terminal control.</p></div>
      </section>
      <section className="ed-width ed-tools" aria-label="Supported coding tools"><p>BRING YOUR TOOLS</p><div><span>Claude Code</span><span>Codex</span><span>Copilot</span><span>OpenCode</span><span>Custom commands</span></div></section>
      <section className="ed-width ed-release ed-install" id="install" aria-labelledby="release-title">
        <div className="ed-section-head"><h2 id="release-title">Install DuckTerm Lite</h2><a href={installationGuide} className="ed-text-link">Full installation guide ↗</a></div>
        <p>For Apple Silicon Macs running macOS 13+. Everything needed to run DuckTerm is included. Install and sign in to the coding agents you want to use separately.</p>
        <ol className="ed-install-steps">
          <li><h3>Download</h3><p><a href={liteDownload}>Get DuckTerm Lite for Mac</a>. Signed and notarized for macOS.</p></li>
          <li><h3>Add to Applications</h3><p>Unzip the download and move <strong>DuckTerm Lite.app</strong> to your Applications folder.</p></li>
          <li><h3>Open and start a session</h3><p>Open DuckTerm Lite, choose <strong>New → New session</strong>, and select an installed coding agent and your project.</p><p>Git is needed for Git workstreams.</p></li>
        </ol>
      </section>
    </main>
    <footer className="ed-width ed-footer"><a href="#lite" className="ed-brand" onClick={event => { event.preventDefault(); choose("lite"); window.scrollTo({top:0}); }}><img src="/duckmark.svg" alt="" width="22" height="22"/>DuckTerm</a><p>Source available · <a href="https://github.com/utsavanand/duckterm/blob/main/LICENSE">FSL-1.1-MIT</a><br/>Becomes MIT after two years.</p></footer>
    <DemoPlayback/>
  </div>;
}
