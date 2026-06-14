import { Duck } from "./Duck";
import { Dashboard, Walkthrough } from "./Live";

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
            <a href="/protocol">Onboard a harness</a>
            <a href="#get-started">Get started</a>
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
          <h1>
            Headquarters for your
            <br />
            team of agents.
          </h1>
          <p className="sub">
            Run many AI coding agents at once. RubberDuckHQ is the single window
            that launches them into isolated git worktrees, shows what each is
            doing, and surfaces the one that needs you. On your machine, your
            code never leaves it.
          </p>
          <p className="hero-no">
            No new IDE. No new terminal. Keep the tools you already use.
          </p>
          <div className="hero-cta">
            <a href="#get-started" className="btn btn-primary">
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

      {/* the core idea, right under the hero */}
      <div className="container">
        <section id="features" className="hero-feature-section">
          <div className="core-idea">
            <div className="section-kicker">The core idea</div>
            <h2>Run many agents at once.</h2>
            <p>
              Stop babysitting one agent in one terminal. Launch several at the
              same time — each on its own branch of your repo — and watch them
              all from one place. One window tells you which are working, which
              are idle, and which are blocked waiting on your answer.
            </p>
          </div>
        </section>
      </div>

      {/* product visual — a faithful, live recreation of the real dashboard */}
      <div className="container">
        <div className="product">
          <Dashboard />
        </div>
      </div>

      {/* how a session is born — the new-session walkthrough */}
      <div className="container">
        <section className="walk-section">
          <div className="section-head">
            <div className="section-kicker">Watch</div>
            <h2 className="section-title">Start a session in seconds.</h2>
            <p className="section-sub">
              Click New session, pick an agent, pick a folder — it lands in
              RubberDuckHQ and starts reporting on its own.
            </p>
          </div>
          <Walkthrough />
        </section>
      </div>

      {/* features */}
      <div className="container">
        <section style={{ borderTop: "none", paddingTop: 0 }}>
          <div className="features">
            <Feature
              icon="eye"
              tag="Observability"
              title="One window over your fleet"
              body="Every running agent in one view — what each is doing, which one needs you, how they relate. Stop juggling a terminal per agent."
            />
            <Feature
              icon="tree"
              tag="Lineage"
              title="Fork into a tree"
              body="Fork any running session — the code or just the conversation — and follow the whole lineage as a tree of attempts."
            />
            <Feature
              icon="bell"
              tag="Human in the loop"
              title="Answer who's blocked"
              body="Live state for every session: working, idle, or waiting on a permission request. The Needs human panel surfaces exactly who is blocked on you, with Approve and Deny right there."
            />
            <Feature
              icon="play"
              tag="Resume"
              title="Pick any session back up"
              body="Sessions are durable. Come back to one later and resume it where it left off — its history, prompts, and worktree are still there."
            />
            <Feature
              icon="swap"
              tag="Handoff"
              title="Continue in another harness"
              body="Out of tokens in Claude Code? Hand a session off to Codex or Copilot and keep going. Resume across harnesses, not just within one."
            />
            <Feature
              icon="flag"
              tag="Checkpoints"
              title="Save points per session"
              body="Mark a checkpoint and capture what was done — prompts, commands, files, and a summary — so you can return to a known-good point at any time."
            />
          </div>
        </section>
      </div>

      {/* get started — install + run in one place */}
      <div className="container">
        <section id="get-started">
          <div className="section-head">
            <div className="section-kicker">Get started</div>
            <h2 className="section-title">Up and running in one step.</h2>
            <p className="section-sub">
              One Python package. No account, no cloud. Bring your own agents
              and your own API key — RubberDuckHQ never sees your code or
              credentials.
            </p>
          </div>
          <div className="start-wrap">
            <pre className="start-pre">
              {`# install the orchestrator
pipx install rubberduckhq

# connect your agent and run the dashboard
rubberduck install-hooks --global
rubberduck serve`}
            </pre>
            <p className="note">
              Requires Python 3.11+ — no other Python dependencies. Then open{" "}
              <code>http://localhost:4200</code> and start your agent; sessions
              appear on their own. To watch agents you start yourself, the hook
              needs <code>jq</code> (<code>brew install jq</code>) and a
              one-time <code>rubberduck install-hooks --global</code>.
            </p>
          </div>
        </section>
      </div>

      {/* cta */}
      <div className="container">
        <section className="cta" style={{ border: "none" }}>
          <h2>Let&apos;s talk.</h2>
          <p>RubberDuckHQ is in active development.</p>
          <a
            href="https://utsava.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            utsava.xyz
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
          <span>Your code stays yours</span>
        </footer>
      </div>
    </>
  );
}

function Feature({
  icon,
  tag,
  title,
  body,
}: {
  icon: keyof typeof ICONS;
  tag: string;
  title: string;
  body: string;
}) {
  return (
    <div className="feature">
      <div className="feature-icon">{ICONS[icon]}</div>
      <div className="tag">{tag}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

const ICONS = {
  eye: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  tree: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="5" rx="1.2" />
      <rect x="3" y="16" width="6" height="5" rx="1.2" />
      <rect x="15" y="16" width="6" height="5" rx="1.2" />
      <path d="M12 8v3M6 16v-2.5h12V16" />
    </svg>
  ),
  bell: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  ),
  play: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9.2v5.6l4.5-2.8z" fill="currentColor" stroke="none" />
    </svg>
  ),
  swap: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
    </svg>
  ),
  flag: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />
    </svg>
  ),
};
