import { Duck } from "./Duck";

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

      {/* product visual — a faithful recreation of the real dashboard */}
      <div className="container">
        <div className="product">
          <Dashboard />
        </div>
      </div>

      {/* the one headline feature, in its own box */}
      <div className="container">
        <section id="features" className="hero-feature-section">
          <div className="hero-feature">
            <div className="hf-copy">
              <div className="section-kicker">The core idea</div>
              <h2>Run many agents at once.</h2>
              <p>
                Stop babysitting one agent in one terminal. Launch several at
                the same time — each on its own branch of your repo — and watch
                them all from one place. The dashboard tells you which are busy,
                which are idle, and which are blocked waiting on your answer.
              </p>
            </div>
            <div className="hf-stat">
              <Lane label="api-refactor" state="busy" />
              <Lane label="auth-migration" state="wait" />
              <Lane label="release-notes" state="idle" />
              <Lane label="search-feature" state="busy" />
            </div>
          </div>
        </section>
      </div>

      {/* supporting features */}
      <div className="container">
        <section style={{ borderTop: "none", paddingTop: 0 }}>
          <div className="features">
            <Feature
              icon="branch"
              tag="Isolation"
              title="One repo, many features"
              body="Each session runs in its own git worktree on a fresh branch. Several agents work the same repository in parallel without conflicts. Merge any branch back with a normal git merge."
            />
            <Feature
              icon="tree"
              tag="Lineage"
              title="Fork into a tree"
              body="Fork any running session — the code or just the conversation — and follow the whole lineage as a tree of attempts."
            />
            <Feature
              icon="bell"
              tag="Attention"
              title="See who needs you"
              body="Live state for every session: busy, idle, or waiting on a permission request. The Needs human panel surfaces exactly who is blocked on you."
            />
            <Feature
              icon="clock"
              tag="History"
              title="Durable record"
              body="Every session is retained with its prompts, commands, and an outcome summary. Catch up without re-reading transcripts."
            />
            <Feature
              icon="plug"
              tag="Compatibility"
              title="Bring any agent"
              body="Claude Code, Codex, and Copilot connect through hooks — no wiring. Any other CLI agent works through the launch path."
            />
            <Feature
              icon="columns"
              tag="Comparison"
              title="Run approaches side by side"
              body="Launch one prompt across multiple agents on sibling branches and review the results next to each other."
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
              Requires Python 3.11+. No pipx? <code>brew install pipx</code>.
              Then open <code>http://localhost:4200</code> and start your agent
              — sessions appear on their own.
            </p>
          </div>
        </section>
      </div>

      {/* cta */}
      <div className="container">
        <section className="cta" style={{ border: "none" }}>
          <h2>Want in early?</h2>
          <p>
            RubberDuckHQ is in active development. If you run agents at scale,
            or just want to try it, reach out.
          </p>
          <a href="mailto:utsava@utsava.xyz" className="btn btn-primary">
            utsava@utsava.xyz
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
          <span>Runs on localhost · Your code stays yours</span>
        </footer>
      </div>
    </>
  );
}

/* ── the dashboard recreation ── */

function Dashboard() {
  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-brand">
          <Duck size={18} />
          <span>RubberDuckHQ</span>
          <span className="live-dot" />
          <span className="live-label">Live</span>
        </div>
        <div className="dash-actions">
          <span className="dbtn">Compare</span>
          <span className="dbtn">Snapshots</span>
          <span className="dbtn dbtn-primary">New session</span>
        </div>
      </div>
      <div className="dash-grid">
        {/* agents */}
        <div className="dash-col">
          <div className="col-head">Agents</div>
          <div className="tabs">
            <span className="tab tab-on">Active 4</span>
            <span className="tab">Idle 1</span>
            <span className="tab">Watched 5</span>
            <span className="tab">All 5</span>
          </div>
          <AgentRow
            name="api-refactor"
            meta="checkout-service · 31 ev"
            badge="WATCHED"
            state="busy"
          />
          <AgentRow
            name="auth-migration"
            meta="checkout-service · 14 ev"
            badge="WATCHED"
            state="wait"
          />
          <AgentRow
            name="release-notes"
            meta="docs · 9 ev"
            badge="LAUNCHED"
            state="idle"
          />
          <AgentRow
            name="search-feature"
            meta="forked · api-refactor · 6 ev"
            badge="WATCHED"
            state="busy"
          />
          <AgentRow
            name="dep-upgrade"
            meta="checkout-service · 22 ev"
            badge="LAUNCHED"
            state="busy"
          />
        </div>
        {/* needs human */}
        <div className="dash-col">
          <div className="col-head">Needs human</div>
          <div className="hitl">
            <div className="hitl-top">
              <span className="hitl-name">
                <span className="dot-wait" /> auth-migration
              </span>
            </div>
            <div className="hitl-cmd">
              Bash · <code>psql -c &apos;DROP TABLE refunds_tmp&apos;</code>
            </div>
            <div className="hitl-cta">
              <span className="approve">Approve</span>
              <span className="deny">Deny</span>
            </div>
          </div>
          <div className="hitl">
            <div className="hitl-top">
              <span className="hitl-name">
                <span className="dot-wait" /> dep-upgrade
              </span>
            </div>
            <div className="hitl-cmd">
              Bash · <code>rm -rf node_modules &amp;&amp; npm ci</code>
            </div>
            <div className="hitl-cta">
              <span className="approve">Approve</span>
              <span className="deny">Deny</span>
            </div>
          </div>
        </div>
        {/* pulse */}
        <div className="dash-col">
          <div className="col-head">
            Pulse <span className="pulse-live">live</span>
          </div>
          <PulseRow
            time="08:24:08"
            name="api-refactor"
            ok
            line="Bash · npm run test -- checkout"
          />
          <PulseRow
            time="08:23:57"
            name="api-refactor"
            line="Edit · src/checkout/idempotency.ts"
          />
          <PulseRow
            time="08:23:43"
            name="dep-upgrade"
            ok
            line="Bash · npm outdated --json"
          />
          <PulseRow
            time="08:23:19"
            name="auth-migration"
            line="Grep · refund · src/payments"
          />
          <PulseRow
            time="08:23:04"
            name="search-feature"
            ok
            line="Read · src/checkout/store.ts"
          />
          <PulseRow
            time="08:22:55"
            name="api-refactor"
            line="Edit · src/checkout/store.ts"
          />
          <PulseRow
            time="08:22:48"
            name="release-notes"
            line="prompt · draft the 0.3 release notes"
          />
          <PulseRow
            time="08:22:32"
            name="dep-upgrade"
            ok
            line="Bash · npm install && npm test"
          />
        </div>
      </div>
    </div>
  );
}

function AgentRow({
  name,
  meta,
  badge,
  state,
}: {
  name: string;
  meta: string;
  badge: string;
  state: "busy" | "idle" | "wait";
}) {
  const label =
    state === "busy" ? "BUSY" : state === "wait" ? "WAITING" : "IDLE";
  return (
    <div className="arow">
      <div className="arow-main">
        <div className="arow-name">{name}</div>
        <div className="arow-meta">{meta}</div>
      </div>
      <div className="arow-right">
        <span className="arow-badge">{badge}</span>
        <span className={`arow-state st-${state}`}>
          <span className={`dot-${state}`} /> {label}
        </span>
      </div>
    </div>
  );
}

function PulseRow({
  time,
  name,
  line,
  ok,
}: {
  time: string;
  name: string;
  line: string;
  ok?: boolean;
}) {
  return (
    <div className="prow">
      <span className="ptime">{time}</span>
      <div className="pbody">
        <span className="pname">{name}</span>
        <span className="pline">
          <span className={ok ? "pmark-ok" : "pmark-run"}>
            {ok ? "✓" : "→"}
          </span>{" "}
          {line}
        </span>
      </div>
    </div>
  );
}

function Lane({
  label,
  state,
}: {
  label: string;
  state: "busy" | "idle" | "wait";
}) {
  return (
    <div className={`lane lane-${state}`}>
      <span className={`dot-${state}`} />
      <span className="lane-name">{label}</span>
      <span className="lane-track">
        <span className="lane-fill" />
      </span>
    </div>
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
  branch: (
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
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M8.4 7.2C12 9 15.5 8.5 15.5 11.5" />
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
  clock: (
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
      <path d="M12 7v5l3.5 2" />
    </svg>
  ),
  plug: (
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
      <path d="M9 2v5M15 2v5M7 7h10v3a5 5 0 0 1-10 0V7ZM12 15v7" />
    </svg>
  ),
  columns: (
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
      <rect x="3" y="4" width="7" height="16" rx="1.4" />
      <rect x="14" y="4" width="7" height="16" rx="1.4" />
    </svg>
  ),
};
