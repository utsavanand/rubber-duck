# Rubberduck

Shadow companion across multiple agents and sessions — a second brain looking
over your shoulder.

Local-first orchestrator for AI coding agents. Launches agents (Claude Code,
Codex, any CLI agent) into isolated git worktrees, supervises them, lets you
fork a running session into a tree of parallel attempts, and keeps durable
history with an intention → outcome summary per session.

Design: [`rubberduck-design.md`](./rubberduck-design.md).

## Install

```sh
pipx install rubberduckhq
```

Requires Python 3.11+. No pipx? `brew install pipx` (macOS) or see
[pipx docs](https://pipx.pypa.io/stable/installation/). pipx installs the CLI in
its own isolated environment, which avoids the `externally-managed-environment`
error a bare `pip install` hits on Homebrew Python.

Bring your own agent (Claude Code, Codex, any CLI agent) and your own API key —
Rubberduck never sees your code or credentials.

## Use it

There are two commands, and they do different things:

```sh
rubberduck install-hooks --global   # ONCE: wire Claude Code to report to Rubberduck
rubberduck serve                    # EACH TIME: run the server + dashboard at :4200
```

- **`install-hooks`** edits the agent's hook config so every session
  automatically streams into Rubberduck. Run it **once** per machine (or once
  per repo without `--global`). Defaults to Claude Code; pass `--agent codex`
  or `--agent copilot` to wire those too (Codex: use `--global`, its repo-local
  hooks are unreliable upstream).
- **`serve`** is the running process: it receives those events, stores history,
  serves the dashboard, and orchestrates agents you launch. Run it **whenever**
  you want Rubberduck active, and leave it running. Open **http://localhost:4200**.

`install-hooks` makes Claude *talk to* Rubberduck; `serve` is what's *listening*.
You need both — but only `serve` repeatedly.

Then just use Claude Code as usual — sessions appear in the dashboard on their
own. From there you can launch agents into isolated git worktrees, fork a
session into a tree of parallel attempts, answer permission requests, and read
per-session checkpoints (prompts, files, tools, outcome). Runtimes: `generic`
(any CLI), `claude-code` (richest — hook events + JSONL transcript), `codex`.

## Two kinds of session

- **Watched** — you start `claude` in your own terminal; the hooks report each
  event to Rubberduck. Rubberduck observes but doesn't own the process. These
  run on whatever branch you already have checked out.
- **Launched** — you click **New session** in the dashboard. Rubberduck opens a
  new tab in your terminal (iTerm or Terminal), runs the agent there, and — for
  a git repo — creates an isolated worktree first. It detects a killed tab via a
  20s heartbeat and marks the session terminated after 60s of silence.

## How worktrees work

A launched session on a git repo gets its own **git worktree** — a second
working directory that shares your repo's `.git` object store. Picking the repo
`~/code/myapp` creates:

```
~/.rubberduck/worktrees/myapp/rubberduck/<branch>/   # the worktree (a checkout)
```

on a new branch `rubberduck/<session-name>` (slug of the name you gave it, or a
timestamp). That branch lives **in your repo** — `git branch` in `~/code/myapp`
lists it. The agent works in the worktree without touching your main checkout.

To fold a session's work back in, from your repo:

```sh
git merge rubberduck/<branch>     # or rebase, or open a PR from that branch
```

Deleting a session from the dashboard removes its worktree and branch. If the
branch has commits not yet in `main`, delete asks before discarding them.

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

State lives in `~/.rubberduck/` (override with `RUBBERDUCK_HOME`).
