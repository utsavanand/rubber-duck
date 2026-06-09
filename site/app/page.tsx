import { Duck } from "./Duck";

const FLEET: { kind: "busy" | "idle" | "wait"; color: string }[] = [
  { kind: "busy", color: "#4b5cff" },
  { kind: "wait", color: "#c2820b" },
  { kind: "idle", color: "#18a957" },
  { kind: "busy", color: "#4b5cff" },
  { kind: "idle", color: "#18a957" },
];

export default function Home() {
  return (
    <>
      {/* nav */}
      <div className="container">
        <nav className="nav">
          <div className="brand">
            <Duck size={26} />
            <span>RubberDuckHQ</span>
          </div>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#install">Install</a>
            <a href="#how">How it works</a>
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
          <div className="fleet" aria-label="A fleet of agents">
            {FLEET.map((d, i) => (
              <Duck key={i} size={30} color={d.color} />
            ))}
          </div>
          <span className="eyebrow">Local-first · Bring your own agents</span>
          <h1>Headquarters for your fleet of AI agents.</h1>
          <p className="sub">
            Run many agents at once, coding and non-coding alike. RubberDuckHQ
            is the single window that orchestrates them across isolated git
            worktrees, shows what each is doing, and surfaces the one that needs
            you. On your machine, with your code never leaving it.
          </p>
          <div className="hero-cta">
            <a href="#install" className="btn btn-primary">
              Get started
            </a>
            <a
              href="https://github.com/utsavanand/rubber-duck"
              className="btn btn-ghost"
            >
              View on GitHub
            </a>
          </div>
        </header>
      </div>

      {/* product mock */}
      <div className="container">
        <div className="product">
          <div className="window">
            <div className="window-bar">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
            <div className="window-body">
              <Sess
                kind="busy"
                name="api-refactor"
                state="Busy"
                meta="Edit · up 4m 12s · 31 events"
              />
              <Sess
                kind="wait"
                name="auth-migration"
                state="Waiting on you"
                meta="PermissionRequest · up 2m 03s · 14 events"
              />
              <Sess
                kind="idle"
                name="release-notes"
                state="Idle"
                meta="research · 2 drafts · 9 events"
              />
              <Sess
                kind="busy"
                name="search-feature"
                state="Busy"
                meta="forked from api-refactor · up 1m 40s"
              />
            </div>
          </div>
        </div>
      </div>

      {/* features */}
      <div className="container">
        <section id="features" style={{ borderTop: "none", paddingTop: 0 }}>
          <div className="section-head">
            <div className="section-kicker">Capabilities</div>
            <h2 className="section-title">Orchestrate many agents at once</h2>
            <p className="section-sub">
              Not a single-agent assistant. RubberDuckHQ is the orchestration
              and observability layer around every agent you run, coding and
              non-coding work side by side.
            </p>
          </div>
          <div className="features">
            <Feature
              tag="Isolation"
              title="One repo, many features"
              body="Each session runs in its own git worktree on a fresh branch in your repo. Several agents work the same repository in parallel without conflicts. Merge any branch back with a normal git merge."
            />
            <Feature
              tag="Lineage"
              title="Fork into a tree"
              body="Fork any running session onto a sibling branch and follow the entire lineage as a tree of attempts."
            />
            <Feature
              tag="Attention"
              title="See who needs you"
              body="Live state for every session: busy, idle, or waiting on input. Stop watching five terminals at once."
            />
            <Feature
              tag="History"
              title="Durable record"
              body="Every session is retained with its stated intention and an outcome summary. Catch up without reading transcripts."
            />
            <Feature
              tag="Compatibility"
              title="Bring any agent"
              body="Claude Code, Codex, or any CLI agent. Claude Code connects automatically through hooks, no wiring required."
            />
            <Feature
              tag="Evaluation"
              title="Compare approaches"
              body="Run one prompt across multiple agents on sibling branches and review the results side by side."
            />
          </div>
        </section>
      </div>

      {/* install */}
      <div className="container">
        <section id="install">
          <div className="install-wrap">
            <div>
              <div className="section-kicker">Install</div>
              <h2 className="section-title">A single Python package.</h2>
              <p className="section-sub">
                RubberDuckHQ installs with pipx and runs locally. Bring your own
                agents and your own API key. RubberDuckHQ never sees your code
                or credentials.
              </p>
              <p className="note">
                Requires Python 3.11 or later. No pipx?{" "}
                <code>brew install pipx</code>.
              </p>
            </div>
            <div>
              <pre>
                {`# install the orchestrator
pipx install rubberduckhq

# connect it to Claude Code, then run it
rubberduck install-hooks --global
rubberduck serve`}
              </pre>
            </div>
          </div>
        </section>
      </div>

      {/* how it works */}
      <div className="container">
        <section id="how">
          <div className="section-head">
            <div className="section-kicker">How it works</div>
            <h2 className="section-title">Running in three steps</h2>
            <p className="section-sub">
              A local server and a dashboard. No account, no cloud. Your code
              and API keys never leave your machine.
            </p>
          </div>
          <div className="steps">
            <Step
              n="Once"
              title="Connect your agent"
              body="A one-time setup: wire Claude Code so every session reports to RubberDuckHQ. Run it once and forget it."
              code="rubberduck install-hooks --global"
            />
            <Step
              n="Each time"
              title="Start the server"
              body="The running process that listens, stores history, and serves the dashboard. Leave it running."
              code="rubberduck serve"
            />
            <Step
              n="Then"
              title="Work as usual"
              body="Use your agents normally. Sessions appear in the dashboard on their own, no extra steps."
              code="open the dashboard"
            />
          </div>
        </section>
      </div>

      {/* cta */}
      <div className="container">
        <section className="cta" style={{ border: "none" }}>
          <h2>Interested in early access?</h2>
          <p>
            RubberDuckHQ is in active development. If you run agents at scale
            and want to talk, or want in early, reach out.
          </p>
          <a
            href="https://github.com/utsavanand/rubber-duck"
            className="btn btn-primary"
          >
            Get in touch
          </a>
        </section>
      </div>

      {/* footer */}
      <div className="container">
        <footer>
          <div className="brand">
            <Duck size={22} />
            <span>RubberDuckHQ</span>
          </div>
          <span>Local-first · Runs on localhost · Your code stays yours</span>
        </footer>
      </div>
    </>
  );
}

function Sess({
  kind,
  name,
  state,
  meta,
}: {
  kind: "busy" | "idle" | "wait";
  name: string;
  state: string;
  meta: string;
}) {
  const hue =
    kind === "busy" ? "#4b5cff" : kind === "wait" ? "#c2820b" : "#18a957";
  return (
    <div className={`sess s-${kind}`}>
      <div className="bar" />
      <div className="top">
        <span className="name">
          <Duck size={16} color={hue} />
          {name}
        </span>
        <span className="state">{state}</span>
      </div>
      <div className="meta">{meta}</div>
    </div>
  );
}

function Feature({
  tag,
  title,
  body,
}: {
  tag: string;
  title: string;
  body: string;
}) {
  return (
    <div className="feature">
      <div className="tag">{tag}</div>
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
  n: string;
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
