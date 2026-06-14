# Fork with a different agent — design

## Why
Switch agents mid-task without losing work. The driving case: Claude runs low on
tokens (or you hit a limit / want a second opinion), and you want to **continue
the same work in Codex** — same code, ideally same context.

## The core constraint
There are two things a fork can carry over:

| Carries | Cross-agent? | Why |
|---|---|---|
| **Code** (a branch / worktree) | ✅ yes | git is agent-neutral. Any agent can open the worktree and see the files. |
| **Conversation** (the chat transcript) | ⚠️ same-agent only | Each agent can resume **its own** sessions natively, but no two agents share a transcript format. |

**All three agents support native conversation resume** (verified against the
installed CLIs):

- Claude: `claude --resume <id> --fork-session`
- Codex: `codex resume <session-id> [prompt]` (also has a `/fork` command)
- Copilot: `copilot --resume=<session-id>` (or `--continue`)

So same-agent conversation fork works for **all three**, not just Claude. The
only thing that genuinely can't cross is one agent resuming *another agent's*
transcript — there's no shared format.

## The matrix

| Fork ↓ / agent → | resume itself | switch to a different agent |
|---|---|---|
| **Worktree fork** (code) | ✅ launch same agent in the new worktree | ✅ launch ANY agent in the new worktree (it sees the code, fresh chat) |
| **Conversation fork** (chat) | ✅ native resume (claude/codex/copilot each resume their own) | ❌ no shared transcript → use the **handoff** (worktree + summary) |

- **Worktree fork → any agent: trivially correct.** The fork already creates a
  worktree and launches an agent there; today the agent is hardcoded to
  `claude`. Adding an agent picker is the whole change. Covers "continue in
  Codex" for the common case.
- **Conversation fork → same agent: native, for all three.** Generalize the
  current Claude-only `_fork_conversation` into a per-runtime resume command
  (each runtime declares how to resume one of its sessions).
- **Conversation fork → different agent: the "handoff".** Can't replay one
  agent's transcript into another, so approximate it: worktree (carries code) +
  seed the new agent's opening prompt with a summary of the old session.

## The handoff mechanism (cross-agent "continue")
We already capture everything needed — today's checkpoint work made the
checkpoint contain: the human **prompts**, the **commands run**, and a
**what-was-done summary**. That IS the handoff payload.

Flow for "Continue <session> in <agent>":
1. Create a worktree off the session's branch (carries the code state).
2. Build a handoff prompt from the session's latest checkpoint:
   - intent / what was being done (summary)
   - the prompts given so far
   - recent commands run / files touched
3. Launch the chosen agent in the worktree with that as its `initial_prompt`
   (the launch path already supports `--prompt` / initial prompt).

The new agent doesn't get the literal chat, but it gets the *context* — which is
what actually matters for continuing the task. And it's agent-neutral: works for
Codex, Copilot, or any CLI agent.

## What to build (when approved)
1. **Worktree fork: add the agent picker** (Claude/Codex/Copilot/Custom) to
   ForkModal's worktree path. The `_fork` server handler already takes a
   `command`; today the UI hardcodes `claude`. Wire the picker → `command`.
   Small, fully correct.
2. **Conversation fork: generalize beyond Claude.** Today `_fork_conversation`
   is hardcoded to `claude --resume … --fork-session` and gated to claude-code.
   Add a `resume_command(session_id)` to the runtime contract so each runtime
   declares how to resume itself:
   - claude-code: `claude --resume <id> --fork-session`
   - codex: `codex resume <id>`
   - copilot: `copilot --resume=<id>`
   Then conversation-fork works for any session whose runtime supports it (all
   three do). Requires the agent's session_id to be recorded — already stored
   for claude; confirm codex/copilot session_id arrives via their hook events.
3. **New "Continue in another agent" action** (cross-agent handoff): worktree +
   new agent + checkpoint-derived initial prompt. Reuses `_fork`/`_promote` +
   the existing `build_checkpoint` summary. Medium.

## What NOT to build
- Cross-agent transcript replay. There's no shared format; faking it would be
  fragile and lossy. The summary handoff is the honest approximation.
- A new endpoint per agent. One `command` parameter already selects the agent.

## Open questions
- Should the handoff prompt be editable before launch (let the user tweak the
  summary)? Probably yes — show it in the modal.
- How much history to include? The last checkpoint's summary + prompts is
  likely enough; full command history could be long. Cap it.
