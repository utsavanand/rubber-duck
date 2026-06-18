# Structured render: HTML-annotation mode + pagination mode

Designed with the user 2026-06-18. Two top-bar toggle modes that render an
agent's responses as rich, navigable, annotatable content — built on ONE
foundation: read the agent's **structured output** (not terminal bytes) and
render it. The raw terminal stays; these are alternate views you toggle into.

## The thesis

The terminal mirrors what the agent paints. To let the user *annotate a section*
or *page through* a long response and *send feedback back to the agent*,
Rubberduck has to **understand the response as data** — messages, tool calls,
prose blocks — not pixels. This is the "control the window" moat: only possible
because we own the window AND have the structured data.

Both modes are the same feature with two display styles. Build the foundation
once; layer the modes on top.

## The structured source (decided): tail Claude's JSONL transcript

Claude Code already writes a structured transcript to
`~/.claude/projects/<slug>/<session_id>.jsonl`, one JSON record per line.
Verified structure (real session):

- `{type:"user", message:{role:"user", content:"..."}}` — a user prompt
- `{type:"assistant", message:{role:"assistant", content:[{type:"text", text}]}}`
  — a prose response block (this is what we render/annotate/paginate)
- `{type:"assistant", ...content:[{type:"tool_use", name, input}]}` — a tool call
- `{type:"user", ...content:[{type:"tool_result", ...}]}` — a tool result
- plus non-message records (`mode`, `permission-mode`, `ai-title`, …) we skip

**Why the transcript, not `--output-format stream-json`:** stream-json replaces
the interactive session (it's print/pipeline mode) — we'd lose the terminal.
Tailing the transcript file runs ALONGSIDE the live terminal: the terminal keeps
working, and we get the same structured data as a side-channel. `parse_transcript`
in `runtimes/claude_code.py` already reads these records; we extend it to keep
record identity + block boundaries (not just flattened `{role,text}`).

This is claude-code-specific for now (it's the one with a structured
transcript). Other harnesses fall back to terminal-only (no structured modes)
until they expose equivalent structure — consistent with the harness-adapter
model.

## The foundation (build once)

1. **Structured transcript reader** — extend `claude_code.py` to yield records
   with: stable `id` (line index or content hash), `role`, ordered content
   blocks (`text` | `tool_use` | `tool_result`), and `ts`. Keep the existing
   flat `parse_transcript` for the summarizer; add a structured variant.
2. **Server endpoint** — `GET /sessions/:key/messages` returns the structured
   records for a launched claude session (locates the transcript via the runtime,
   parses, returns JSON). Live updates: re-fetch on the session's PreToolUse/Stop
   events (already on the event stream), same pattern as the sub-agent tree.
3. **Annotations store** — a `annotations` table: `(id, session_key, record_id,
   anchor, quote, note, created_at)`. `anchor` = a char range or block ref into
   the record's text. `GET/POST /sessions/:key/annotations`.
4. **Send-back-to-agent** — POST an annotation (or a section's feedback) →
   Rubberduck composes a follow-up prompt ("Re: \"<quote>\" — <note>") and writes
   it to the agent's stdin via the existing `write_bytes` (the same path the
   terminal uses). So feedback re-enters the conversation as a normal turn.

## Mode 1 — HTML-annotation

Top-bar toggle. When on, the center pane shows the agent's `assistant.text`
blocks rendered as **HTML** (markdown → HTML), each block selectable.

- Select any span in a response → a popover to add a note (highlight + comment).
- The annotation is stored AND sent back to the agent as a follow-up prompt
  referencing the quoted span.
- Tool calls/results render as collapsible chips between prose blocks (context,
  not the focus).
- The raw terminal is one toggle away (for slash commands, TUI moments).

## Mode 2 — Pagination

Top-bar toggle. A long response is split into **sections** (one per
`assistant.text` block, or per turn) shown one at a time.

- Arrow keys: ← / → step prev/next section. A position indicator (3 / 12).
- Each section has a **feedback box**; the note is stored and sent back to the
  agent referencing that section.
- Same store + send-back path as Mode 1 — only the display differs (one section
  at a time vs. the full scroll).

Open question (flagged by the user — resolve before building Mode 2): how this
interacts with a STILL-STREAMING response. Proposal: paginate only completed
turns; the in-flight turn shows in the terminal until it lands as a transcript
record, then becomes a page.

## What's reused vs new

| Piece | Status |
|---|---|
| Structured transcript records exist in the JSONL | ✅ (parse_transcript reads them) |
| Locating the transcript per session | ✅ (`locate_transcript`) |
| Live refresh on events | ✅ (event stream, sub-agent-tree pattern) |
| write_bytes to send a prompt back | ✅ (terminal input path) |
| Structured reader keeping block identity | ❌ new (extend claude_code.py) |
| `/sessions/:key/messages` endpoint | ❌ new |
| annotations table + endpoints | ❌ new |
| HTML render + selection→annotation UI | ❌ new |
| Pagination UI (arrow-step + per-section feedback) | ❌ new |
| Two top-bar toggles + view switching | ❌ new |

## Build order

1. Foundation: structured reader + `/sessions/:key/messages` (read-only HTML
   render of assistant text blocks; no annotation yet). Ship + look at it.
2. Annotations store + send-back; wire selection→note→follow-up. (Mode 1 done.)
3. Pagination view over the same records + per-section feedback. (Mode 2 done.)
4. The two top-bar toggles + remember the choice.

Each step is independently shippable and testable (Playwright e2e against a real
claude session, like the terminal).

## Scope / honesty

- **claude-code only** at first — it's the harness with a structured transcript.
  Don't gate the whole feature on a generic abstraction (no harness #2 yet).
- These modes **don't replace** the terminal; they're alternate views. The
  terminal remains the default and the universal fallback.
- Mode 2's streaming interaction is the one genuinely unresolved design question;
  Mode 1 and the foundation have no such unknown.
