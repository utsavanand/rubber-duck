import { Duck } from "./Duck";

export default function Home() {
  return (
    <>
      {/* nav */}
      <div className="container">
        <nav className="nav">
          <div className="brand">
            <Duck size={26} />
            <span>Rubberduck</span>
          </div>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#worktrees">Worktrees</a>
            <a href="#faq">FAQ</a>
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
          <span className="eyebrow">Local-first · Bring your own agent</span>
          <h1>One window over your fleet of AI coding agents.</h1>
          <p className="sub">
            You run several coding agents in parallel and lose track of which is
            working, which is stuck, and which is waiting on you. Rubberduck is
            the single dashboard that shows all of them, launches new ones into
            isolated git worktrees, and keeps a durable record &mdash; on your
            machine, with your code and API keys never leaving it.
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
              <span className="title">Rubberduck &mdash; localhost:4200</span>
            </div>
            <div className="window-body">
              <Sess
                kind="busy"
                name="api-refactor"
                state="Busy"
                meta="Edit · started 11:48 PM · up 4m 12s · 31 events"
              />
              <Sess
                kind="wait"
                name="auth-migration"
                state="Waiting on you"
                meta="PermissionRequest · up 2m 03s · 14 events"
              />
              <Sess
                kind="idle"
                name="docs-pass"
                state="Idle"
                meta="Stop · 2 builds · 1 test · 9 events"
              />
              <Sess
                kind="busy"
                name="search-feature"
                state="Busy"
                meta="↳ forked from api-refactor · up 1m 40s"
              />
            </div>
          </div>
        </div>
      </div>

      {/* the problem */}
      <div className="container">
        <section style={{ borderTop: "none", paddingTop: 0 }}>
          <div className="section-head">
            <div className="section-kicker">The problem</div>
            <h2 className="section-title">
              Five terminals, no idea what&rsquo;s happening
            </h2>
            <p className="section-sub">
              Running agents in parallel means tab-switching to check on each
              one, missing the prompt that&rsquo;s been blocking for ten
              minutes, and agents stepping on each other&rsquo;s changes in the
              same checkout. Rubberduck replaces the tab-switching with one
              view.
            </p>
          </div>
        </section>
      </div>

      {/* features */}
      <div className="container">
        <section id="features">
          <div className="section-head">
            <div className="section-kicker">Capabilities</div>
            <h2 className="section-title">
              An orchestration layer, not another assistant
            </h2>
            <p className="section-sub">
              Rubberduck doesn&rsquo;t write code. It runs and watches the
              agents you already use, and gets out of their way.
            </p>
          </div>
          <div className="features">
            <Feature
              tag="Isolation"
              title="One repo, many features"
              body="Each launched session runs in its own git worktree on a fresh branch in your repo. Several agents edit the same repository in parallel without conflicts — merge any branch back with a normal git merge."
            />
            <Feature
              tag="Attention"
              title="See who needs you"
              body="Live state per session: busy, idle, or waiting on input. The dashboard surfaces the session blocked on a permission prompt so you act on it instead of discovering it later."
            />
            <Feature
              tag="Lineage"
              title="Fork into a tree"
              body="Fork a running session — its worktree or its whole conversation — onto a sibling branch, and follow the lineage as a tree of attempts. Each fork opens in its own terminal tab."
            />
            <Feature
              tag="History"
              title="Durable record"
              body="Every session is kept with its stated intention and an outcome summary, plus checkpoints of prompts, files touched, and tools used. Catch up without re-reading transcripts."
            />
            <Feature
              tag="Compatibility"
              title="Bring any agent"
              body="Claude Code, Codex, or any CLI agent. Claude Code connects automatically through hooks — install once, then every claude session shows up on its own."
            />
            <Feature
              tag="Evaluation"
              title="Compare approaches"
              body="Run one prompt across multiple agents on sibling branches and review the results side by side, instead of picking a model blind."
            />
          </div>
        </section>
      </div>

      {/* what's in the dashboard */}
      <div className="container">
        <section>
          <div className="section-head">
            <div className="section-kicker">In the dashboard</div>
            <h2 className="section-title">What each session card shows</h2>
          </div>
          <div className="features">
            <Feature
              tag="State"
              title="Busy · Idle · Waiting"
              body="Derived from the agent's hook events. A session reads busy while it works, waiting when it hits a permission prompt, and idle only after its turn genuinely ends."
            />
            <Feature
              tag="Context"
              title="Repo, branch, worktree"
              body="The repository, the branch the agent is on, the worktree path on disk, and the session's start time and event count."
            />
            <Feature
              tag="Actions"
              title="Open · Fork · Checkpoint · Stop"
              body="Open the detail view, fork the session, capture a checkpoint, stop the agent, or delete it — which also tears down its worktree and closes the terminal tab Rubberduck opened."
            />
            <Feature
              tag="Notes"
              title="Private, local-only notes"
              body="A per-session notes list for reminders and TODOs. Stored on your machine and never sent to any agent or service."
            />
          </div>
        </section>
      </div>

      {/* how it works */}
      <div className="container">
        <section id="how">
          <div className="section-head">
            <div className="section-kicker">Setup</div>
            <h2 className="section-title">Running in three steps</h2>
            <p className="section-sub">
              A local server and a dashboard. No account, no cloud — your code
              and API keys never leave your machine.
            </p>
          </div>
          <div className="steps">
            <Step
              n="Once"
              title="Connect your agent"
              body="One-time setup: wire Claude Code's hooks so every session reports to Rubberduck. Run it once per machine and forget it."
              code="rubberduck install-hooks --global"
            />
            <Step
              n="Each time"
              title="Start the server"
              body="The running process that listens, stores history, and serves the dashboard at localhost:4200. Leave it running in the background."
              code="rubberduck serve"
            />
            <Step
              n="Then"
              title="Work as usual"
              body="Use Claude Code normally — sessions appear on their own. Or click New session to launch an agent into a fresh worktree in its own terminal tab."
              code="open http://localhost:4200"
            />
          </div>
        </section>
      </div>

      {/* worktrees explainer */}
      <div className="container">
        <section id="worktrees">
          <div className="section-head">
            <div className="section-kicker">How worktrees work</div>
            <h2 className="section-title">
              Isolated checkouts, one shared history
            </h2>
            <p className="section-sub">
              A worktree is a second working directory that shares your
              repo&rsquo;s <code>.git</code> object store. The agent works on
              its own branch without touching your main checkout — and because
              the branch lives in your repo, you merge it back with plain git.
            </p>
          </div>
          <div className="install-wrap">
            <div>
              <p className="note">
                Launching a session on <code>~/code/myapp</code> creates a
                worktree on a new branch named after the session. Both the
                branch and the worktree are removed when you delete the session
                — and if the branch has unmerged commits, delete asks first.
              </p>
            </div>
            <div>
              <pre>
                {`# the worktree, checked out on its own branch
~/.rubberduck/worktrees/myapp/rubberduck/<name>/

# the branch lives in YOUR repo — list it:
cd ~/code/myapp && git branch
#   main
# * rubberduck/login-refactor

# fold the agent's work back in:
git merge rubberduck/login-refactor`}
              </pre>
            </div>
          </div>
        </section>
      </div>

      {/* FAQ */}
      <div className="container">
        <section id="faq">
          <div className="section-head">
            <div className="section-kicker">FAQ</div>
            <h2 className="section-title">Questions you&rsquo;ll have</h2>
          </div>
          <div className="features">
            <Feature
              tag="Privacy"
              title="Does my code leave my machine?"
              body="No. Rubberduck runs entirely on localhost. It never sees your source or your API keys — those stay between you and your agent. There's no account and no cloud."
            />
            <Feature
              tag="Agents"
              title="Which agents are supported?"
              body="Claude Code gets the richest integration (hook events plus JSONL transcripts). Codex is supported, and any CLI agent runs as a generic session — Rubberduck launches it and tracks what it can."
            />
            <Feature
              tag="Watched vs launched"
              title="Do I have to launch from the dashboard?"
              body="No. Sessions you start yourself in your own terminal are watched automatically via hooks. Launching from the dashboard adds the worktree isolation and the terminal tab Rubberduck manages for you."
            />
            <Feature
              tag="Cleanup"
              title="Do worktrees pile up?"
              body="Deleting a session removes its worktree and branch. If the branch has commits not yet in main, delete warns you before discarding them."
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
                Rubberduck installs with pip and runs locally. Bring your own
                agent and your own API key — Rubberduck never sees your code or
                credentials.
              </p>
              <p className="note">Requires Python 3.11 or later.</p>
            </div>
            <div>
              <pre>
                {`# install the orchestrator
pip install rubberduckhq

# connect it to Claude Code, then run it
rubberduck install-hooks --global
rubberduck serve

# open the dashboard
open http://localhost:4200`}
              </pre>
            </div>
          </div>
        </section>
      </div>

      {/* cta */}
      <div className="container">
        <section className="cta" style={{ border: "none" }}>
          <h2>Interested in early access?</h2>
          <p>
            Rubberduck is in active development. If you run agents at scale and
            want to talk — or want in early — reach out.
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
            <span>Rubberduck</span>
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
  return (
    <div className={`sess s-${kind}`}>
      <div className="bar" />
      <div className="top">
        <span className="name">{name}</span>
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
