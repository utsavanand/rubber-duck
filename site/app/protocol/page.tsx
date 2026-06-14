import Link from "next/link";
import { Duck } from "../Duck";

export const metadata = {
  title: "Approval protocol — RubberDuckHQ",
  description:
    "How RubberDuckHQ routes an agent's permission prompts to the dashboard: a blocking pre-exec hook that long-polls for your decision and returns it to the agent. Per-harness support for Claude Code, Copilot, and Codex.",
};

export default function Protocol() {
  return (
    <>
      <div className="container">
        <nav className="nav">
          <Link href="/" className="brand">
            <Duck size={26} />
            <span>RubberDuckHQ</span>
          </Link>
          <div className="nav-links">
            <Link href="/#features">Features</Link>
            <Link href="/#get-started">Get started</Link>
            <a
              href="https://github.com/utsavanand/rubber-duck"
              className="btn btn-ghost"
            >
              GitHub
            </a>
          </div>
        </nav>
      </div>

      <div className="container">
        <article className="doc">
          <div className="section-kicker">How it works</div>
          <h1 className="doc-title">The approval protocol</h1>
          <p className="doc-lede">
            When an agent wants to run a tool — a shell command, a web fetch, a
            file edit — it can pause and ask permission. RubberDuckHQ routes
            that question to your dashboard and sends your answer back to the
            agent, so you approve or deny without switching to its terminal. The
            dashboard is the decision-maker, not a remote control faking
            keystrokes.
          </p>

          <h2>The flow</h2>
          <p>
            Each agent runs a small hook script that RubberDuckHQ installs. For
            a permission event, the hook <strong>blocks</strong> — it
            doesn&apos;t return until it has an answer:
          </p>
          <ol className="doc-steps">
            <li>
              <strong>Register.</strong> The hook <code>POST /approvals</code>{" "}
              with the tool name and its input (the command, the URL, the file).
              It gets back an approval id.
            </li>
            <li>
              <strong>Surface.</strong> The request appears in the
              dashboard&apos;s <em>Needs human</em> panel — what tool, what it
              wants to do, which session.
            </li>
            <li>
              <strong>Wait.</strong> The hook long-polls{" "}
              <code>GET /approvals/:id/decision</code> — <code>pending</code>{" "}
              until you answer.
            </li>
            <li>
              <strong>Decide.</strong> You click Approve or Deny. The dashboard{" "}
              <code>POST /approvals/:id/decide</code> records it.
            </li>
            <li>
              <strong>Return.</strong> The hook&apos;s next poll reads{" "}
              <code>approve</code> / <code>deny</code> and prints the
              harness-specific decision JSON to the agent — which then proceeds
              or cancels the tool call.
            </li>
          </ol>

          <h2>Fail-open by design</h2>
          <p>
            The hook never wedges an agent. If RubberDuckHQ isn&apos;t running,
            the token is missing, or you don&apos;t answer within a few minutes,
            the hook prints nothing and the agent falls through to its own
            inline prompt — exactly as if RubberDuckHQ weren&apos;t there.
            Denial is the only fail-closed case, and only when you explicitly
            deny.
          </p>

          <h2>Per-harness support</h2>
          <p>
            The protocol depends on the agent having a pre-execution hook that
            can <em>block and return a decision</em>. Not every CLI does — so
            support differs:
          </p>
          <div className="proto-table">
            <div className="proto-row proto-head">
              <span>Harness</span>
              <span>Blocking hook</span>
              <span>Decide from dashboard</span>
            </div>
            <div className="proto-row">
              <span>Claude Code</span>
              <span>
                <code>PermissionRequest</code>
              </span>
              <span className="yes">Yes</span>
            </div>
            <div className="proto-row">
              <span>GitHub Copilot CLI</span>
              <span>
                <code>preToolUse</code>
              </span>
              <span className="yes">Yes (local mode)</span>
            </div>
            <div className="proto-row">
              <span>OpenAI Codex CLI</span>
              <span>interactive only</span>
              <span className="no">Observe + jump to terminal</span>
            </div>
          </div>
          <p className="doc-note">
            Claude Code and Copilot return a decision the agent honors, so you
            answer from the dashboard. Codex&apos;s approval flow is
            interactive-only, so for those (and for watched sessions started in
            your own terminal) RubberDuckHQ shows the request and a one-click
            jump to that session&apos;s terminal tab to answer there.
          </p>

          <h2>The decision the agent gets</h2>
          <p>
            The hook emits the JSON each harness expects. The request and
            polling are identical across harnesses; only this last shape
            differs:
          </p>
          <pre className="doc-code">
            {`# Claude Code
{"hookSpecificOutput":{"hookEventName":"PermissionRequest",
  "decision":{"behavior":"allow"}}}

# Copilot
{"permissionDecision":"allow"}`}
          </pre>

          <h2>One interface, many agents</h2>
          <p>
            RubberDuckHQ models every agent behind one Harness contract — where
            its hook config lives, how it reports activity, and whether it can
            route approval externally. New agents plug in by declaring those
            capabilities; the server side (register, poll, decide) is the same
            for all of them.
          </p>

          <p className="doc-back">
            <Link href="/">← Back to RubberDuckHQ</Link>
          </p>
        </article>
      </div>

      <div className="container">
        <footer>
          <Link href="/" className="brand">
            <Duck size={22} />
            <span>RubberDuckHQ</span>
          </Link>
          <span>Runs on localhost · Your code stays yours</span>
        </footer>
      </div>
    </>
  );
}
