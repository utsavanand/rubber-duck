# Approve / Deny from the dashboard (blocking approval, cross-harness)

## The problem
Today the "Needs human" panel is fire-and-forget: the permission hook POSTs the
request and exits (`async:true`), Rubberduck only *observes*, and "Approve" tries
to send keystrokes to the agent's terminal tab (fragile, timing-dependent, and
silent for many prompts). Worse, some prompts never reach Rubberduck at all, so
no button appears.

The fix: make the permission hook **block** and let Rubberduck **return the
decision**, so the dashboard is the real approval authority — no keystroke
injection, works for launched and watched sessions alike.

## What each harness actually supports (researched)

| Harness | Blocking pre-exec hook | Returns allow/deny | Route approval to a dashboard |
|---|---|---|---|
| **Claude Code** | `PreToolUse` / `PermissionRequest` | yes (`permissionDecision`) | **yes** |
| **GitHub Copilot CLI** | `preToolUse` | yes (`permissionDecision`) | **yes** (local mode) |
| **OpenAI Codex CLI** | `PreToolUse` exists | deny works; approval is interactive-only | **no** (not supported) |

So: **Claude Code and Copilot can truly route approval externally; Codex cannot.**
The design must degrade gracefully for Codex (observe + jump-to-terminal), and
the unified interface must say *per harness* whether external approval is
possible.

## Design — the blocking hook protocol

1. The pre-exec hook (Claude `PermissionRequest`, Copilot `preToolUse`) runs
   **synchronously** (`async:false`), with a generous timeout.
2. It POSTs the request to `POST /approvals` and gets back an **approval id**.
3. It **long-polls** `GET /approvals/:id/decision` (a few seconds at a time)
   until the server reports `allow` / `deny`, or it hits a fallback timeout.
4. It emits the harness's decision JSON to stdout and exits:
   - Claude: `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}`
   - Copilot: `{"permissionDecision":"allow"|"deny"}`
5. On timeout / server-down / network error → emit **"ask"** (fall through to the
   agent's own inline prompt). Fail-open so Rubberduck being down never blocks an
   agent; fail-closed only for genuine deny.

The dashboard's **Approve/Deny** writes the decision via `POST
/approvals/:id/decide`; the polling hook picks it up and returns it. **No
keystroke injection, no terminal focus** — the decision flows back through the
hook for both launched and watched sessions.

## Unified interface (`Harness`)
Add to the `Harness` contract a small, declarative approval capability:

- `approval: ApprovalSpec | None` — None means "observe only" (Codex today).
- `ApprovalSpec` declares:
  - the **hook event** that carries the request (per harness),
  - how to **render the decision** the harness expects (the JSON shape above),
  - so the shared hook script can branch on `$RUNTIME` to emit the right form.

The server side is harness-agnostic (a request id + a decision store); only the
*shape of the returned decision* and *which hook event blocks* are per-harness,
expressed in `ApprovalSpec`. This keeps it part of the uniform interface, with
Codex declaring `approval = None` and getting the existing observe + jump-to-
terminal affordance.

## Server pieces
- `POST /approvals` (hook → register, returns id). Replaces the implicit
  approval-from-PermissionRequest-event creation.
- `GET /approvals/:id/decision` (hook long-polls; returns pending/allow/deny).
- `POST /approvals/:id/decide` (dashboard writes the decision) — already exists;
  point it at the decision store instead of keystroke injection.
- A pending-decision store keyed by approval id, with timeouts.

## Migration / fallback
- Keep the keystroke-injection path **only** as a fallback for a harness that
  has no blocking hook but a known tty (so nothing regresses), or drop it once
  the blocking path is proven.
- The hook must **always** terminate (timeout) and default to "ask" so a missing
  or slow Rubberduck never wedges an agent.

## Build order
1. Server decision-store + `GET /approvals/:id/decision` + repoint `/decide`.
2. `ApprovalSpec` on `Harness`; Claude + Copilot declare it; Codex declares None.
3. Hook script: block + long-poll + emit per-runtime decision JSON; fail-open.
4. Dashboard: unchanged (Approve/Deny already call `/decide`); show "ask in
   terminal / jump" for `approval = None` harnesses.
5. Remove (or gate) the keystroke-injection fallback.
