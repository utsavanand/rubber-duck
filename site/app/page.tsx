export default function Home() {
  return (
    <>
      <div className="container">
        <nav className="nav">
          <div className="brand">
            <span>🦆</span>
            <span>
              Rubber<span className="duck">duck</span>
            </span>
          </div>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#install">Install</a>
            <a
              href="https://github.com/utsavanand/rubber-duck"
              className="btn btn-ghost"
            >
              GitHub
            </a>
          </div>
        </nav>
      </div>

      {/* hero */}
      <div className="container">
        <header className="hero">
          <span className="eyebrow">
            Local-first · runs on your machine · bring your own agent
          </span>
          <h1>
            One window over your{" "}
            <span className="grad">fleet of AI agents</span>
          </h1>
          <p className="sub">
            You run five coding agents in five terminals. Rubberduck is the one
            window that tells you what they&rsquo;re all doing &mdash; and which
            one needs you right now.
          </p>
          <div className="hero-cta">
            <a href="#install" className="btn btn-primary">
              Install
            </a>
            <a href="#how" className="btn btn-ghost">
              See how it works
            </a>
          </div>
          <div>
            <span className="code-chip">
              <span className="dollar">$</span> pip install rubberduck
            </span>
          </div>

          {/* live-dashboard mock */}
          <div className="terminal">
            <div className="terminal-bar">
              <span className="dot r" />
              <span className="dot y" />
              <span className="dot g" />
            </div>
            <div className="terminal-body">
              <div className="sess busy">
                <div className="top">
                  <span className="name">api-refactor</span>
                  <span className="state">busy</span>
                </div>
                <div className="meta">
                  PreToolUse · Edit · up 4m 12s · 31 events
                </div>
              </div>
              <div className="sess waiting">
                <div className="top">
                  <span className="name">auth-migration</span>
                  <span className="state">waiting on you</span>
                </div>
                <div className="meta">
                  PermissionRequest · up 2m 03s · 14 events
                </div>
              </div>
              <div className="sess idle">
                <div className="top">
                  <span className="name">docs-pass</span>
                  <span className="state">idle</span>
                </div>
                <div className="meta">Stop · 2 builds · 1 test · 9 events</div>
              </div>
              <div className="sess busy">
                <div className="top">
                  <span className="name">search-feature</span>
                  <span className="state">busy</span>
                </div>
                <div className="meta">forked from api-refactor · up 1m 40s</div>
              </div>
            </div>
          </div>
        </header>
      </div>

      {/* features */}
      <div className="container">
        <section id="features">
          <h2 className="section-title">
            Built for running many agents at once
          </h2>
          <p className="section-sub">
            Not another single-agent chat. Rubberduck is the control plane for
            parallel work.
          </p>
          <div className="features">
            <Feature
              icon="🌳"
              title="One repo, many features"
              body="Each session runs in its own isolated git worktree. Five agents on one repo, zero collisions."
            />
            <Feature
              icon="🔱"
              title="Fork into a tree"
              body="Fork any running session into a sibling branch and follow the whole lineage as a tree."
            />
            <Feature
              icon="🚦"
              title="See who needs you"
              body="Live state per session — busy, idle, or waiting-on-you. Stop hovering over five terminals."
            />
            <Feature
              icon="📜"
              title="Durable history + summaries"
              body="Every session is kept with its intention and an outcome summary. Catch up without reading transcripts."
            />
            <Feature
              icon="🔌"
              title="Bring any agent"
              body="Claude Code, Codex, or any CLI agent. Claude Code auto-streams in via hooks — no curl, no glue."
            />
            <Feature
              icon="⚖️"
              title="Compare models"
              body="Run one prompt as several agents on sibling branches and compare the results side by side."
            />
          </div>
        </section>
      </div>

      {/* how it works */}
      <div className="container">
        <section id="how">
          <h2 className="section-title">Up and running in three steps</h2>
          <p className="section-sub">
            It&rsquo;s a local server plus a dashboard. No account, no cloud,
            your code never leaves your machine.
          </p>
          <div className="steps">
            <Step
              n={1}
              title="Wire your agent"
              body="Auto-connect Claude Code so every session streams in."
              code={"rubberduck install-hooks --global"}
            />
            <Step
              n={2}
              title="Start the server"
              body="A local process that watches and orchestrates."
              code={"rubberduck serve"}
            />
            <Step
              n={3}
              title="Just use your agents"
              body="Open the dashboard and work as usual — sessions appear automatically."
              code={"cd web && npm run dev"}
            />
          </div>
        </section>
      </div>

      {/* install */}
      <div className="container">
        <section id="install">
          <div className="install">
            <h2 className="section-title">Install</h2>
            <p className="section-sub" style={{ margin: "0 auto 8px" }}>
              Rubberduck is a zero-dependency Python package. The dashboard is a
              small React app.
            </p>
            <pre>
              {`# the orchestrator (Python)
pip install rubberduck

# wire it to Claude Code, then run it
rubberduck install-hooks --global
rubberduck serve`}
            </pre>
            <p className="note">
              Requires Python 3.11+. Bring your own agent (Claude Code, Codex,
              &hellip;) and your own API key &mdash; Rubberduck never sees your
              code or keys.
            </p>
          </div>
        </section>
      </div>

      {/* contact */}
      <div className="container">
        <section className="contact">
          <h2 className="section-title">
            Interested? Building something similar?
          </h2>
          <p className="section-sub" style={{ margin: "0 auto 4px" }}>
            Rubberduck is early. If you run a lot of agents and want to talk
            &mdash; or want early access &mdash; reach out.
          </p>
          <a
            href="https://github.com/utsavanand/rubber-duck"
            className="btn btn-primary"
          >
            Get in touch on GitHub
          </a>
          <p className="note">Contact options coming soon.</p>
        </section>
      </div>

      <div className="container">
        <footer>
          <span>
            🦆 Rubberduck &mdash; local-first orchestrator for AI coding agents
          </span>
          <span>
            Bring your own agent · runs on localhost · your code stays yours
          </span>
        </footer>
      </div>
    </>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="feature">
      <div className="icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  code,
}: {
  n: number;
  title: string;
  body: string;
  code: string;
}) {
  return (
    <div className="step">
      <div className="n">{n}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      <pre>{code}</pre>
    </div>
  );
}
