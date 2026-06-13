# Rubberduck

Shadow companion across multiple agents and sessions — a second brain looking
over your shoulder.

Local-first orchestrator for AI coding agents. Launches agents (Claude Code,
Codex, GitHub Copilot CLI, any CLI agent) into isolated git worktrees,
supervises them, lets you fork a running session into a tree of parallel
attempts, and keeps durable history with an intention → outcome summary per
session.

Design: [`rubberduck-design.md`](./rubberduck-design.md).

## Install

```sh
pipx install rubberduckhq
```

Requires Python 3.11+. No pipx? `brew install pipx` (macOS) or see
[pipx docs](https://pipx.pypa.io/stable/installation/). pipx installs the CLI in
its own isolated environment, which avoids the `externally-managed-environment`
error a bare `pip install` hits on Homebrew Python.

Bring your own agent (Claude Code, Codex, GitHub Copilot CLI, any CLI agent) and
your own API key — Rubberduck never sees your code or credentials.

## Use it

There are two commands, and they do different things:

```sh
rubberduck install-hooks --global   # ONCE: wire your agent to report to Rubberduck
rubberduck serve                    # EACH TIME: run the server + dashboard at :4200
```

- **`install-hooks`** edits the agent's hook config so every session
  automatically streams into Rubberduck. Run it **once** per machine (or once
  per repo without `--global`). Defaults to Claude Code; wire others with
  `--agent`:

  ```sh
  rubberduck install-hooks --global                  # Claude Code (default)
  rubberduck install-hooks --agent codex --global    # Codex
  rubberduck install-hooks --agent copilot --global  # GitHub Copilot CLI
  ```

  Per-agent notes:
  - **Claude Code** and **Copilot** work as soon as you run `serve`.
  - **Codex** writes the config, but Codex won't run a hook until you *trust*
    it: start `codex`, run `/hooks`, and trust the Rubberduck hook (you'll
    re-trust if Rubberduck updates the hook script). Use `--global` — Codex's
    repo-local hooks are unreliable upstream.

- **`serve`** is the running process: it receives those events, stores history,
  serves the dashboard, and orchestrates agents you launch. Run it **whenever**
  you want Rubberduck active, and leave it running. Open **http://localhost:4200**.

`install-hooks` makes the agent *talk to* Rubberduck; `serve` is what's
*listening*. You need both — but only `serve` repeatedly.

Then just use your agent as usual — sessions appear in the dashboard on their
own. From there you can launch agents into isolated git worktrees, fork a
session into a tree of parallel attempts, answer permission requests, and read
per-session checkpoints (prompts, files, tools, outcome). Runtimes: `generic`
(any CLI), `claude-code` (richest — hook events + JSONL transcript), `codex`,
`copilot`.

The server binds `127.0.0.1` and gates requests with a per-install secret
(stored `0600` at `~/.rubberduck/token`) plus a same-origin check, so a web page
you visit can't drive it. The hook script and dashboard read the token
automatically; you never handle it.

## The dashboard

`http://localhost:4200` is three columns:

- **Agents** — every session as a row, with forks nested under their parent.
  A badge marks each as **watched** or **launched** (see below); a `⎇` glyph
  marks the ones working on a git branch. Click a row for its detail drawer
  (timeline, diff, output, checkpoints, notes); notes save inline.
- **Needs you** — sessions waiting on a permission request, with inline
  Approve/Deny (for sessions Rubberduck can reach).
- **Pulse** — a live ticker of the latest action across every agent.

## Two kinds of session

- **Watched** — you start the agent (`claude`, `codex`, `copilot`) in your own
  terminal; its hooks report each event to Rubberduck. Rubberduck observes but
  doesn't own the process, so it can't type to it or answer its prompts — those
  happen in your terminal. Watched sessions run on whatever branch you have
  checked out.
- **Launched** — you click **New session** in the dashboard. Rubberduck opens a
  new tab in your terminal (iTerm or Terminal), runs the agent there, and owns
  the process — so you can drive it and answer permission requests from the
  dashboard. It detects a killed tab via a 20s heartbeat and marks the session
  terminated after 60s of silence.

Each row's **watched/launched** badge tells you which is which at a glance.

## Git is opt-in

Launching a session on a git repo asks how to run it:

- **Run in place** — the agent works directly in the folder, on whatever branch
  is checked out. No branch or worktree is created.
- **Isolated worktree** — the agent gets its own **git worktree**: a second
  working directory that shares your repo's `.git` object store, on a new branch
  off a base you pick (any local or remote branch). Picking the repo
  `~/code/myapp` creates:

  ```
  ~/.rubberduck/worktrees/myapp/rubberduck/<branch>/   # the worktree (a checkout)
  ```

  The branch lives **in your repo** — `git branch` in `~/code/myapp` lists it —
  and the agent works there without touching your main checkout.

Changed your mind? An in-place session has a **Create worktree** action to
branch its work onto a worktree later, for when it turns out worth publishing.

To fold a worktree session's work back in, from your repo:

```sh
git merge rubberduck/<branch>     # or rebase, or open a PR from that branch
```

Deleting a session from the dashboard removes its worktree and branch. If the
branch has commits not yet in `main`, delete asks before discarding them.

## Forking a session

Fork offers two kinds:

- **Git worktree fork** — branch the code into a new worktree off the parent's
  branch, and open a fresh agent there.
- **Conversation fork** — resume the agent's conversation in a new terminal
  (Claude Code's `--fork-session`), no branch.

## Notes

Each session has a **Notes** tab — a private, local-only list of reminders or
TODOs for that session. Notes never leave your machine and are never sent to any
agent or service.

## Develop

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"

ruff check src tests        # lint
black --check src tests scripts
mypy                        # types (strict)
pytest                      # unit + runtime tests
python scripts/slop_check.py

cd web && npm install
npm run lint && npm run typecheck && npm run build
```

The dashboard ships bundled inside the package. `scripts/build_package.sh`
rebuilds the web app, copies it into `src/rubberduck/dashboard/`, and builds the
wheel + sdist — run it before publishing. During development, `cd web && npm run
dev` serves the UI at `:5173` and proxies the API to a `serve` on `:4200`.

State lives in `~/.rubberduck/` (override with `RUBBERDUCK_HOME`).
