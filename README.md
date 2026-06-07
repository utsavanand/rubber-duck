# Rubberduck

Shadow companion across multiple agents and sessions — a second brain looking
over your shoulder.

Local-first orchestrator for AI coding agents. Launches agents (Claude Code,
Codex, any CLI agent) into isolated git worktrees, supervises them, lets you
fork a running session into a tree of parallel attempts, and keeps durable
history with an intention → outcome summary per session.

Design: [`rubberduck-design.md`](./rubberduck-design.md). Built Act by Act
(0–10 complete).

## Run

```sh
pip install -e .
rubberduck serve                       # http://127.0.0.1:4200
# in another shell:
rubberduck launch "claude" --cwd ~/myrepo --prompt "add a healthcheck"
rubberduck snapshot                    # bundle active sessions

cd web && npm install && npm run dev   # dashboard (proxies to the server)
```

Launch on a repo to get an isolated git worktree per session; fork a session
to branch it; sessions are tracked live and persisted with an intention →
outcome summary. Runtimes: `generic` (any CLI), `claude-code` (richest —
hook events + JSONL transcript), `codex`.

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
