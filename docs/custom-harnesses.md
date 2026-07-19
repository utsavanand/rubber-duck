# Custom harnesses (suites)

Two layers, two contracts:

| Layer | Contract | Examples | What it is |
|---|---|---|---|
| Coding harness | `Harness` (`runtimes/base.py`) | claude-code, codex, copilot | The agent CLI that runs the model |
| Custom harness | manifest + `overlays.py` | UV Suite, a team's Ruby wrapper | A suite of skills/hooks/guardrails installed on top of a coding harness |

## What a CODING harness can extend (`Harness`)

One adapter class per agent, registered in `harnesses.py`:

| Member | What it teaches Rubberduck |
|---|---|
| `launch_command(cwd, session_key, initial_prompt)` | how to start the agent |
| `restore_command(cwd, session_key)` | how to resume a stopped session |
| `detect_state(recent_output)` | busy/waiting/idle from raw output (fallback when hooks are absent) |
| `tool_in(recent_output)` | which tool is running, from output |
| `locate_transcript / read_transcript` | where its conversation lives and how to parse it (checkpoints, forks) |
| `hook_spec: HookSpec` | where its hook config lives + merge/strip, so watched sessions stream in |
| `approval: ApprovalSpec` | which hook event blocks for dashboard Approve/Deny and the exact decision JSON it expects (`None` = observe-only) |

## What a CUSTOM harness can extend (the manifest)

The contract is the suite's manifest — `duckterm-harness.json` at the suite's
root, established by Rubberterm. **One manifest per suite; each product reads
the fields it consumes and ignores the rest** (Rubberterm's loader already
tolerates unknown fields).

| Field | What it declares | Consumed by | Status |
|---|---|---|---|
| `name`, `description` | identity | both | shipped |
| `install` (argv, `{dir}` placeholder) | how to install the suite into a project | Rubberterm dashboard (`suites.py`) | shipped |
| `uninstall` (argv) | how to remove it | Rubberterm | shipped |
| `args_choices` (flag → allowed values) | installer options, rendered as pickers | Rubberterm | shipped |
| `base` | which coding harness it wraps — the session inherits that harness's transcript/approval/hooks | Rubberduck | shipped (this change) |
| `session_meta` (`sessions_dir`, `pointer`, `fields`) | where the suite keeps per-session name/tags | Rubberduck `/sessions` labeling | shipped (this change) |
| skills listing | which skills the suite adds | both | deferred — build with the all-skills dashboard view |
| custom hook events | suite-specific data pushed at runtime | Rubberduck | informal today: `POST /events` accepts extra fields, `PATCH /sessions/:key` sets the name. Formalize a schema when a second suite needs more |
| launch-through-suite | starting a suite session from New session | Rubberduck | deferred — needs a launcher argv field |

UV Suite's entry (currently built-in data in `overlays.OVERLAYS`; the shape is
exactly the manifest's, so moving to reading its `duckterm-harness.json` from
disk is mechanical once suite registration lands here):

```json
{
  "name": "uv-suite",
  "base": "claude-code",
  "session_meta": {
    "sessions_dir": ".uv-suite-state/sessions",
    "pointer": ".uv-suite-state/current-session.txt",
    "fields": ["name", "kind", "priority", "purpose"]
  }
}
```

## How a session gets its suite — the announcement protocol

The suite's launcher exports, before starting the base agent:

```sh
export RUBBERDUCK_OVERLAY=uv-suite
export RUBBERDUCK_OVERLAY_SESSION=<the suite's own session id>
```

Hook processes inherit the env, so the shared hook script forwards both fields
on every event with no per-suite logic in bash (same principle as
ApprovalSpec: bash stays generic, Python knows the specifics). The server
validates `overlay` against the registry and `overlay_session` against a
path-safe charset (it's interpolated into a filename), persists both on the
session row, and `GET /sessions` attaches `overlay_name`.

Sessions that predate the announcement (today's UV Suite doesn't export yet)
are probed via the manifest's `pointer` file. Correct for one suite session
per project directory; two concurrent ones in the same cwd both show the
pointed-at name until their launchers announce.

## Label priority (dashboard)

explicit rename > `overlay_name` > iTerm tab title > cwd folder name > key prefix

## Reconciliation state vs Rubberterm

- Rubberterm `suites.py` owns **installation** (manifest `install`/`uninstall`/
  `args_choices`); Rubberduck `overlays.py` owns **runtime identity** (`base`/
  `session_meta` + the env announcement). Same manifest, disjoint fields — no
  conflict, and either product can adopt the other's fields later.
- Rubberterm's `runtimes/base.py` is a pre-ApprovalSpec fork of the `Harness`
  contract (no `approval` field). When syncing the repos, pull Rubberduck's
  base.py forward — the ApprovalSpec change is additive.
