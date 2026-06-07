# Rubberduck

Shadow companion across multiple agents and sessions — a second brain looking
over your shoulder.

Local-first orchestrator for AI coding agents. Launches agents (Claude Code,
Codex, any CLI agent) into isolated git worktrees, supervises them, lets you
fork a running session into a tree of parallel attempts, and keeps durable
history with an intention → outcome summary per session.

Design: [`rubberduck-design.md`](./rubberduck-design.md). Built Act by Act.

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
