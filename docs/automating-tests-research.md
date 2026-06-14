# Can the manual tests be automated with Playwright?

Short answer: **~70% yes with Playwright, but Playwright is only half the rig.**
The browser half (clicking the dashboard, asserting on panels) is Playwright's
job. The other half — "look at the terminals, see what the agent did" — is NOT
something Playwright can do, because that happens *outside* the browser. You
automate it by driving Rubberduck's own backend (HTTP API + filesystem +
subprocess), not the browser.

So the real architecture is **Playwright (UI) + pytest/subprocess (backend &
filesystem) in one harness**, sharing a server and a temp `RUBBERDUCK_HOME`.

## What Playwright CAN do here
- Drive the dashboard: click New session, Fork, Approve/Deny, filters, expand a
  Pulse row, open the drawer, type + Save notes. Assert on what renders.
- Wait for live updates (SSE-driven panels) with auto-waiting locators.
- Capture screenshots/video/traces of each flow (great for the README too).
- Run headless in CI.

## What Playwright CANNOT do (and the workaround)
| Manual case | Why Playwright can't | How to automate it instead |
|---|---|---|
| "A terminal tab opens in iTerm" | Playwright sees only the browser, not macOS apps | **Don't open a real terminal.** Use Rubberduck's headless launch (`in_terminal: false`) — the server supervises the agent in a PTY, no terminal app. Assert via the API/output stream. |
| "The agent did X" | The agent runs in a PTY, not the DOM | Use the **fake agent** (`tests/fakes/fake_agent.py`) — deterministic, scriptable, no tokens. Assert on the session state/events it produces. |
| Codex `/hooks` trust | Interactive TUI prompt, no automation hook | **Can't** — stays manual. (Or `--dangerously-bypass-hook-trust` in a throwaway sandbox, never in real CI.) |
| Reboot persistence | A reboot | **Can't** truly; approximate by killing+restarting the `serve` process and asserting reattach. |
| Real LLM summary quality | Non-deterministic model output | Assert the summary *exists and is non-empty* with a **stub summarizer** (`RUBBERDUCK_SUMMARIZER_CMD="cat"` or `printf …`), not its prose. Real quality stays a human eyeball. |
| Checkpoint reads a real agent transcript | Needs a real claude/codex/copilot transcript on disk | Drop a **fixture transcript file** in the temp home and assert the parser picks it up (already unit-tested; an e2e variant can stage one). |

## The "set up test codebases / packages" idea — yes, do this
This is the strongest part of your instinct. The harness should, per test:
1. Create a **temp git repo** (the existing `git_repo` fixture already does this)
   and a temp non-git folder.
2. Point `RUBBERDUCK_HOME` at a temp dir (existing `_isolated_home` fixture).
3. Start `rubberduck serve` on an ephemeral port as a subprocess.
4. Launch sessions **headless with the fake agent** against those repos.
5. Open the dashboard in Playwright pointed at that server, assert the UI.
6. Cross-check the **filesystem** (worktrees created, checkpoint .md written,
   token file 0600) and the **API** (`/sessions`, `/sessions/:key/events`).
7. Tear down the temp repo + home.

Most of these fixtures already exist for the pytest runtime tests — Playwright
plugs into the same harness as another assertion surface, not a separate one.

## Coverage estimate against `manual-test-cases.md`
| Section | Automatable? |
|---|---|
| 1 Install & serve | Mostly (serve, port-conflict, exit). `pipx install` = separate CI job. |
| 2 Hooks | Config writing ✅ (assert the JSON files). Real watched-session-appears ✅ via fake agent + posting events. **Codex trust = manual.** Reboot = manual. |
| 3 New session | ✅ fully (Playwright clicks + headless launch + fs assert) |
| 4 Fork | ✅ worktree/conversation/promote/collapse, with fake agents |
| 5 HITL | ✅ post a PermissionRequest, assert Approve/Deny + watched badge |
| 6 Pulse | ✅ detail, click-to-expand, cap |
| 7 Checkpoints | ✅ structure (prompts/commands/files/summary-exists) with stub summarizer + fixture transcript. **Summary *quality* = manual.** |
| 8 Drawer | ✅ timeline/diff/notes; output stream ✅ headless |
| 9 Filters | ✅ |
| 10 Worktree lifecycle | ✅ unmerged guard, fail-closed, merge-back, tab-close-by-tty (assert the API/fs, not the visible tab) |
| 11 Compare/Snapshots | ✅ |
| 12 Security | ✅ already curl-able; Playwright can also assert the dashboard sends the token |
| 13 Resilience | tmux-restart ✅ (kill+restart serve); reboot/upgrade = manual |

**Net: roughly 50–55 of ~70 cases are automatable**; ~15 stay manual (trust
prompts, reboots, real-LLM quality, real terminal-app visuals).

## Recommendation
1. **Most automatable cases don't even need Playwright** — they're API +
   filesystem assertions, which our pytest runtime suite already does. Extend
   *those* first; it's the cheapest, most stable coverage.
2. **Add Playwright for the genuinely UI-only cases** (Pulse click-to-expand,
   collapse forks, notes Save state, filter toggles, the drawer tabs) — things
   you can only verify by rendering. Use `pytest-playwright` so it shares the
   same fixtures and server.
3. **Keep a small manual list** for what truly can't be automated (Codex trust,
   reboot, real-LLM summary quality) — `manual-test-cases.md` marks these.

## Cost/risk note
A browser E2E suite is real maintenance: flaky waits, CI browser deps, slower
runs. Worth it for the UI-only flows, overkill for anything assertable via the
API. Don't Playwright-ify a test you can check with a `curl` — the architecture
guardrail applies to tests too.
