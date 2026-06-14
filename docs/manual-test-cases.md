# Manual test cases

Things a human should verify by hand — flows that touch real terminals, real
agents, hook trust, reboots, and the browser, which the automated suite can't
cover. Run these before a release.

**Setup once:**
- A clean machine (or `RUBBERDUCK_HOME=/tmp/rd-test` to isolate state).
- At least one agent installed (claude / codex / copilot).
- A git repo and a non-git folder to point sessions at.

Mark each: ✅ pass / ❌ fail / ⏭ skipped (and why).

---

## 1. Install & serve

| # | Steps | Expected |
|---|---|---|
| 1.1 | `pipx install rubberduckhq` on a machine with no Python on PATH | Installs; `rubberduck --version` works |
| 1.2 | `rubberduck serve` | Prints "serving on http://127.0.0.1:4200" **only after** it's actually listening; dashboard loads at :4200 |
| 1.3 | Start a second `rubberduck serve` on the same port | Clean message "Port 4200 already in use / another Rubberduck is running", exit 1, **no traceback** |
| 1.4 | `rubberduck serve --port 4300` | Serves on 4300 |
| 1.5 | Ctrl-C the server | Exits cleanly, no traceback |

## 2. Hooks (per agent)

| # | Steps | Expected |
|---|---|---|
| 2.1 | `rubberduck install-hooks --global` | Writes `~/.claude/settings.json`; prints confirmation |
| 2.2 | Start `claude` in a hooked repo, with `serve` running | A **watched** session appears in the dashboard on its own |
| 2.3 | `rubberduck install-hooks --agent codex --global` | Writes `~/.codex/hooks.json`; prints the **trust** instruction |
| 2.4 | Start `codex`, run `/hooks`, trust the Rubberduck hook, then use it | A **watched** codex session appears |
| 2.5 | `rubberduck install-hooks --agent copilot --global`, start `copilot`, use it | A **watched** copilot session appears |
| 2.6 | Run install-hooks twice for the same agent | Idempotent — no duplicate hook entries in the config |
| 2.7 | `rubberduck uninstall-hooks --global` | Removes only Rubberduck's entries; other hooks untouched |
| 2.8 | Reboot the machine, start `claude` again (no re-install) | Still watched — hooks persist across reboot |

## 3. New session (launch)

| # | Steps | Expected |
|---|---|---|
| 3.1 | Click **New session** | Modal opens with an **agent picker**: Claude Code / Codex / Copilot / Custom |
| 3.2 | Pick **Custom** | A free-text command box appears (for bring-your-own) |
| 3.3 | Pick a **git folder** via Browse | Asks "Run in place" vs "Isolated worktree" (no default) |
| 3.4 | Choose **Isolated worktree** | Shows a "base branch" dropdown (local + remote branches) and an optional new-branch name |
| 3.5 | Launch with worktree | A terminal tab opens, agent runs in `~/.rubberduck/worktrees/...`; session shows as **launched** + a git ⎇ glyph |
| 3.6 | Choose **Run in place** on a git folder | Runs in the folder, no worktree/branch created |
| 3.7 | Launch on a **non-git** folder | Runs in place; no worktree option offered |
| 3.8 | Launch, then check the row badge | Shows **launched** (not watched) immediately and after activity |

## 4. Fork

| # | Steps | Expected |
|---|---|---|
| 4.1 | **Fork** a session on a branch | Modal offers **Git worktree** and **Conversation only** |
| 4.2 | Git worktree fork | New nested row under the parent on a new branch; agent opens in a terminal |
| 4.3 | Conversation fork on a **claude-code** session | Resumes the conversation in a new terminal (`claude --resume … --fork-session`) |
| 4.4 | Conversation fork option on a **codex/copilot** session | Available (each resumes its own); confirm it opens |
| 4.5 | Fork a **branchless claude-code** session | The Fork button is reachable; conversation fork works |
| 4.6 | Fork a non-git in-place session | Worktree option creates a worktree from the folder (promote), or errors clearly if not a git repo |
| 4.7 | Collapse a parent row's forks | The ▾ caret hides/shows the child rows |

## 5. HITL — permission requests (Needs human)

| # | Steps | Expected |
|---|---|---|
| 5.1 | A **launched** session hits a permission prompt | Appears in **Needs human** with **Approve / Deny** |
| 5.2 | Click Approve | The agent proceeds (the keystroke reaches it) |
| 5.3 | A **watched** session hits a permission prompt | Shows a "watched" badge (no Approve/Deny); tooltip says answer in its own terminal |
| 5.4 | Click a Needs-human row | Opens that session's detail drawer |
| 5.5 | No pending requests | Panel says "Nothing needs you right now" |

## 6. Pulse

| # | Steps | Expected |
|---|---|---|
| 6.1 | Run activity in any session | Pulse ticks with time · agent · action, newest on top |
| 6.2 | A Bash command runs | Pulse shows the **command**, e.g. "→ Bash · npm test", not just "Bash" |
| 6.3 | Click a Pulse row | It **expands inline** to show full detail (command/prompt/tool input) — does NOT open the side panel |
| 6.4 | Let many events flow | Pulse stays capped (~18), newest pinned; the animated "live" indicator moves |

## 7. Checkpoints (the big one)

| # | Steps | Expected |
|---|---|---|
| 7.1 | Run a real session (give it prompts, let it run tools), then **Checkpoint** | Toast confirms; checkpoint appears in the drawer |
| 7.2 | Open the checkpoint | Contains: **human prompts**, **commands run**, **files changed**, and a **summary** |
| 7.3 | With an agent on PATH, no `RUBBERDUCK_SUMMARIZER_CMD` set | Summary is an LLM-written 2-3 sentences (auto-detected agent), not just counts |
| 7.4 | Summary quality | Reflects what the agent actually *did* (it read the transcript), not only prompt/tool counts |
| 7.5 | Repeat for codex and copilot sessions | Same — responses captured from their transcripts |
| 7.6 | Checkpoint files on disk | `<cwd>/.rubberduck/checkpoints/<key>/checkpoint-*.md` + `latest.md` exist and are readable |
| 7.7 | Restart the server, reopen the session | Checkpoints still listed (persisted in `~/.rubberduck/db.sqlite`) |
| 7.8 | Take a second checkpoint later | Shows a "since last checkpoint" delta, not the whole session again |

## 8. Detail drawer

| # | Steps | Expected |
|---|---|---|
| 8.1 | Click a session row | Drawer opens with tabs: timeline, output, diff, checkpoints, notes |
| 8.2 | **Timeline** tab | Shows that session's events (not empty, not another session's) |
| 8.3 | **Diff** tab on a worktree session | Shows the git diff; on a failed diff shows an error, not a blank |
| 8.4 | **Output** tab on a launched session | Streams live PTY output; an input box to type to the agent |
| 8.5 | **Output** on a watched session | No input box; says "runs in your own terminal" |
| 8.6 | **Notes** — type and Save | Save button enables on change; persists; row shows a "•"; survives reload |

## 9. Filters & list

| # | Steps | Expected |
|---|---|---|
| 9.1 | Filter bar | Has Active / Idle / Watched / Launched / All with live counts |
| 9.2 | Click **Watched** | Shows only watched sessions; **Launched** shows only launched |
| 9.3 | Forks | Nest under their parent row |

## 10. Worktree lifecycle

| # | Steps | Expected |
|---|---|---|
| 10.1 | Delete a session whose branch has **unmerged commits** | Asks before discarding (409 confirm), not silent |
| 10.2 | Delete after a git check failure (e.g. corrupt worktree) | Refuses (fail-closed), doesn't silently discard |
| 10.3 | Delete a launched session | Closes its terminal tab (matched by tty), removes the worktree + branch |
| 10.4 | `git merge rubberduck/<branch>` from the main repo | The fork's work merges cleanly |

## 11. Compare / Snapshots

| # | Steps | Expected |
|---|---|---|
| 11.1 | **Compare** — one prompt across N agents | Launches N sibling sessions on sibling branches |
| 11.2 | **Snapshots → Snapshot all active** | Writes a snapshot to disk; appears in the list |
| 11.3 | Restore a session from a snapshot | Relaunches it in a terminal |

## 12. Security

| # | Steps | Expected |
|---|---|---|
| 12.1 | `curl -X POST http://127.0.0.1:4200/events -d '{}'` (no token) | **401** |
| 12.2 | `curl -X POST .../events -H 'Origin: http://evil.com' -H 'X-Rubberduck-Token: <real>'` | **403** (cross-origin) |
| 12.3 | The dashboard itself | Works — it reads the token from its injected HTML and sends it |
| 12.4 | `~/.rubberduck/token` | Exists, mode 0600 |

## 13. Resilience

| # | Steps | Expected |
|---|---|---|
| 13.1 | Launch a tmux-backed session, restart `serve` | The agent keeps running; reattaches after restart (work not lost) |
| 13.2 | Kill a launched session's terminal tab | Marked terminated after ~60s (heartbeat sweep) |
| 13.3 | Upgrade `rubberduckhq` while a watched session runs | Session unaffected; after upgrade, may need `install-hooks` re-run if the hook script changed |

---

## Known can't-fully-automate
These are exactly why this doc exists: terminal launching (osascript/iTerm),
Codex hook trust, multi-machine/reboot persistence, real LLM summary quality,
and browser CORS behavior.
