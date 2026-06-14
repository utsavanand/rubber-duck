# Rubberduck roadmap

Living list of what's planned, decision-ready, and shipped. Most recent thinking
at the top of each section.

## Next up

### Publish the unreleased work to PyPI  ← highest leverage
`main` is far ahead of the published package. PyPI is on **0.2.0**; everything
below in "Shipped (unreleased)" reaches no user until this happens. The security
gate makes the next release at least **0.3.0** (and it's a breaking change for
existing installs — old hook scripts get 401'd until `install-hooks` is re-run,
so the changelog must say so).

- [ ] Bump version (0.2.0 → 0.3.0) in pyproject.toml + `__init__.py`.
- [ ] `scripts/build_package.sh` (rebuilds dashboard, bundles it, builds wheel).
- [ ] `twine upload` (needs the PyPI token in ~/.pypirc).
- [ ] Changelog note: re-run `install-hooks` after upgrading (token gate).

### Test automation (decision-ready — research done)
See `docs/automating-tests-research.md` and `docs/manual-test-cases.md`.
~50–55 of ~70 manual cases are automatable; ~15 stay manual (Codex trust
prompt, reboots, real-LLM summary quality).

- [ ] Extend the **pytest runtime suite** first — most cases are API +
  filesystem assertions with the fake agent + headless launch. Cheapest,
  most stable.
- [ ] Add **Playwright** (`pytest-playwright`) only for genuinely UI-only flows:
  pulse click-to-expand, collapse forks, notes Save state, filter toggles,
  drawer tabs. Share the existing fixtures/server.
- [ ] Keep `docs/manual-test-cases.md` for what can't be automated.

## Planned

### Fork / continue with a different agent
Switch agents mid-task (e.g. Claude runs low on tokens → continue in Codex).
Design: `docs/fork-with-agent-design.md`.

- [ ] Worktree fork: agent picker (Claude/Codex/Copilot/Custom) — new agent
  gets the code.
- [ ] Conversation fork: generalize beyond Claude. Each runtime declares its
  resume command (`claude --resume --fork-session`, `codex resume <id>`,
  `copilot --resume=<id>`). All three support native resume.
- [ ] Cross-agent handoff: worktree + new agent seeded with a handoff summary
  built from the (now richer) checkpoint.
- [ ] Richer handoff: distill the agent's *actual responses* (now captured) into
  the handoff brief, not just prompts/commands.

### Discoverability
- [ ] `serve` startup hint when no agent hooks are installed.

### Windows support (deferred)
Native Windows needs ConPTY (pywinpty), Windows Terminal launching, and a
tmux replacement for session persistence — a real project, not a patch.
Recommended path is **WSL2** (Linux under the hood, everything works as-is).

## Shipped (unreleased — on main, not yet on PyPI)
- Three-panel dashboard (Agents / HITL "Needs human" / Pulse).
- Security: localhost token + same-origin gate (CSRF/injection hardening).
- Multi-agent hooks: `install-hooks --agent {claude-code,codex,copilot}`,
  with the Codex `/hooks` trust step surfaced.
- Watched vs launched sessions, with a robust sticky `launched` flag + badge.
- Git is opt-in: run-in-place vs worktree, base-branch picker, promote later.
- Fork merged into one action (worktree / promote / conversation).
- New-session agent picker (Claude/Codex/Copilot/Custom).
- Pulse shows the actual command; click a row to expand full detail inline.
- **High-quality checkpoints**: capture human prompts + commands + files AND
  the agent's own responses (read from each harness's transcript:
  Claude/Codex JSONL, Copilot SQLite); summaries work by default via an
  auto-detected CLI agent (`claude -p` / `codex exec` / `copilot -p`).
- Role-based package layout; tests mirror the source layout.
- README overhaul (features, per-agent setup, dashboard screenshot).
- Error-handling fixes: fail-closed delete guard, surfaced task crashes.

## Shipped (released)
- 0.2.0 and earlier: core orchestrator, watched/launched sessions, worktrees,
  fork tree, checkpoints, snapshots, the original dashboard.
