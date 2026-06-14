# Rubberduck roadmap

Living list of what's planned, in-flight, and shipped. Most recent thinking at
the top of each section.

## In progress

### High-quality checkpoints
A checkpoint should be a faithful, useful record of a session — good enough to
hand work off to a human or another agent.

- [x] Capture human prompts + commands run + files changed (events).
- [ ] **Capture the agent's responses** from its transcript, per harness:
  - claude-code: `~/.claude/projects/<slug>/<id>.jsonl` — `parse_transcript` exists.
  - codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl` —
    `response_item` payloads with `{role, content:[{text}]}`.
  - copilot: `~/.copilot/session-store.db` — `turns(user_message,
    assistant_response)` (SQLite, cleanest source).
- [ ] **Summaries by default**: auto-detect an installed CLI agent
  (claude/codex) for the summarizer instead of requiring
  `RUBBERDUCK_SUMMARIZER_CMD`, so good summaries work out of the box.

## Planned

### Fork / continue with a different agent
Switch agents mid-task (e.g. Claude runs low on tokens → continue in Codex).
Design: `docs/fork-with-agent-design.md`.

- [ ] Worktree fork: agent picker (Claude/Codex/Copilot/Custom) — new agent
  gets the code.
- [ ] Conversation fork: generalize beyond Claude. Each runtime declares its
  resume command (`claude --resume --fork-session`, `codex resume <id>`,
  `copilot --resume=<id>`).
- [ ] Cross-agent handoff: worktree + new agent seeded with a handoff summary
  built from the (now richer) checkpoint.

### Discoverability
- [ ] `serve` startup hint when no agent hooks are installed.

## Shipped
- Three-panel dashboard (Agents / HITL / Pulse).
- Security: localhost token + same-origin gate.
- Multi-agent hooks: `install-hooks --agent {claude-code,codex,copilot}`.
- Watched vs launched sessions, with a robust `launched` flag.
- Git is opt-in: run-in-place vs worktree, promote later.
- Role-based package layout.
