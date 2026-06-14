import Link from "next/link";
import { Duck } from "../Duck";

export const metadata = {
  title: "Harness protocol — onboard an agent to RubberDuckHQ",
  description:
    "The integration interface for adding any CLI coding agent to RubberDuckHQ: one Harness adapter (launched + watched), the hook event contract, the registry entry, and graceful levels of support.",
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
          <div className="section-kicker">Integration interface</div>
          <h1 className="doc-title">Onboard a harness</h1>
          <p className="doc-lede">
            A <em>harness</em> is any CLI coding agent — Claude Code, Codex,
            Copilot, or your own. RubberDuckHQ talks to all of them through one
            adapter contract. Onboarding a new agent is: implement that contract
            once, add one line to the registry. The core never imports a
            specific agent — it loads whichever the session declares.
          </p>

          <h2>Two ways a session runs</h2>
          <p>
            Every session is one of two kinds — the same{" "}
            <strong>watched</strong> / <strong>launched</strong> labels you see
            on the dashboard. A harness can support one or both; supporting more
            unlocks more.
          </p>
          <ul className="doc-bullets">
            <li>
              <strong>1. Launched — Rubberduck starts the agent.</strong> You
              click New session; Rubberduck runs the agent&apos;s command for
              you, owns the process, and reads its state from the terminal
              output. Needs only the <em>launch</em> half of the contract, so it
              works for <em>any</em> CLI agent.
            </li>
            <li>
              <strong>2. Watched — you start the agent yourself.</strong> You
              run the agent in your own terminal; its hooks stream events back
              to Rubberduck, which observes it (it doesn&apos;t own the
              process). Needs the agent to have a hook system you declare (a{" "}
              <code>HookSpec</code>); this is what gives precise state, the
              Pulse feed, Needs-human, and history.
            </li>
          </ul>

          <h2>The contract</h2>
          <p>
            A harness is a class implementing this interface (Python today; the
            shape is what matters). Each method is small and single-purpose:
          </p>
          <pre className="doc-code">
            {`class Harness:
    name: str                       # registry key, e.g. "codex"
    hook_spec: HookSpec | None      # for WATCHED support; None = launch-only

    def __init__(self, command: str): ...

    # ── needed to LAUNCH the agent ──
    def launch_command(self, *, cwd, session_key, initial_prompt) -> list[str]
        # the argv to start the agent

    def restore_command(self, *, cwd, session_key) -> list[str]
        # the argv to resume an existing session

    def detect_state(self, recent_output: str) -> SessionState
        # idle | busy | waiting | terminated, read from terminal output
        # (used when there are no hook events driving state)

    def tool_in(self, recent_output: str) -> str | None
        # which tool is running, if detectable from output

    # ── richer history (optional) ──
    def locate_transcript(self, *, cwd, session_id) -> Path | None
    def read_transcript(self, *, cwd, session_id) -> list[{role, text}]
        # the conversation as uniform {role, text} records, newest-last
        # (each agent reads its own native format: JSONL, SQLite, …)`}
          </pre>

          <h2>To support WATCHED: HookSpec</h2>
          <p>
            To let people watch a session they started themselves, the agent
            must have a hook system you declare with a <code>HookSpec</code>:
            the config file location (global + repo-local) and two pure
            functions that <strong>build</strong> (merge our hook entries in)
            and <strong>strip</strong> (remove them) on the parsed config — so
            install and uninstall stay symmetric and idempotent.
          </p>
          <pre className="doc-code">
            {`hook_spec = HookSpec(
    global_rel = Path(".codex") / "hooks.json",   # ~/.codex/hooks.json
    repo_rel   = Path(".codex") / "hooks.json",   # <repo>/.codex/hooks.json
    build = claude_style_build,   # add our entries to the agent's config
    strip = claude_style_strip,   # remove them again
)`}
          </pre>
          <p className="doc-note">
            Agents whose config is shaped like Claude&apos;s reuse the shared{" "}
            <code>build</code>/<code>strip</code> helpers — Codex does exactly
            this. A differently-shaped config (e.g. Copilot&apos;s) supplies its
            own pair.
          </p>

          <h2>The event contract</h2>
          <p>
            The installed hook posts the agent&apos;s lifecycle events to{" "}
            <code>POST /events</code> as one normalized JSON shape, whatever the
            agent&apos;s native field names. RubberDuckHQ accepts snake_case or
            camelCase and maps to:
          </p>
          <pre className="doc-code">
            {`{
  "event_type":  "SessionStart | UserPromptSubmit | PreToolUse |
                  PostToolUse | PermissionRequest | Notification |
                  Stop | SessionEnd",
  "session_id":  "<agent's own session id>",
  "session_key": "<set by Rubberduck on launch, else null>",
  "cwd":         "/path/the/agent/runs/in",
  "tool_name":   "Bash | Edit | WebFetch | …",
  "tool_input":  { … },          # the command, url, file, etc.
  "prompt":      "<user prompt text>",
  "runtime":     "claude-code | codex | copilot",
  "agent_pid":   12345           # so a watched session's death is detected
}`}
          </pre>
          <p>
            From these, the dashboard derives session state, the Pulse feed, the
            Needs-human panel, and durable history — uniformly across agents.
          </p>

          <h2>Register it</h2>
          <p>
            One entry wires the agent into everything: the <code>--agent</code>{" "}
            choices, the New-session picker, runtime construction, hook install,
            and transcript reading for checkpoints.
          </p>
          <pre className="doc-code">
            {`REGISTRY = {
    "claude-code": ClaudeCodeRuntime,
    "codex":       CodexRuntime,
    "copilot":     CopilotRuntime,
    "your-agent":  YourRuntime,   # <- onboard here
    "generic":     GenericRuntime,
}`}
          </pre>

          <h2>Levels of support (degrade gracefully)</h2>
          <p>
            A harness gets exactly the support its capabilities allow — nothing
            is all-or-nothing:
          </p>
          <div className="proto-table">
            <div className="proto-row proto-head">
              <span>Capability</span>
              <span>What it unlocks</span>
            </div>
            <div className="proto-row">
              <span>Launch only (the contract)</span>
              <span>
                Start &amp; resume the agent from the dashboard; coarse state
                from its output. Works for any CLI (the <code>generic</code>{" "}
                runtime).
              </span>
            </div>
            <div className="proto-row">
              <span>+ HookSpec → Watched</span>
              <span>
                Also watch a session you started yourself; precise state, the
                Pulse feed, Needs-human, durable history.
              </span>
            </div>
            <div className="proto-row">
              <span>+ Transcript reader</span>
              <span>
                High-quality checkpoints &amp; handoff summaries from the
                agent&apos;s own messages.
              </span>
            </div>
            <div className="proto-row">
              <span>+ Blocking approval hook</span>
              <span>
                Approve / Deny permission prompts straight from the dashboard.
                (Claude Code, Copilot.)
              </span>
            </div>
          </div>

          <h2>Approvals, specifically</h2>
          <p>
            If the agent has a pre-exec hook that can block and return a
            decision, its permission prompts route to the dashboard: the hook
            registers the request (<code>POST /approvals</code>), long-polls{" "}
            <code>GET /approvals/:id/decision</code>, and returns the
            agent&apos;s allow/deny once you click — no keystroke faking,
            fail-open if RubberDuckHQ is down. Agents without such a hook
            (Codex) still surface the request and offer a one-click jump to
            their terminal to answer there.
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
