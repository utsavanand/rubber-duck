"""Session checkpoints: a record of *what was done* in a session so far.

A checkpoint captures both:
  - mechanical data — the prompts given to the agent, files changed, tool-use
    counts, and git state (branch + working-tree status), read out-of-band from
    the stored events and the worktree;
  - semantic data — a short "what was done" summary (LLM-written when a
    summarizer is configured, mechanical fallback otherwise).

It is a read-only record, not a restore point — we use git for code state. The
record is stored in the DB and also written as a markdown file under
<cwd>/.rubberduck/checkpoints/<session_key>/ for a portable, human-readable log.

Modeled on uv-suite's watchtower checkpoint service.
"""

import subprocess
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rubberduck.summarizer import summarize

Event = dict[str, Any]


@dataclass
class Checkpoint:
    id: str
    session_key: str
    label: str
    summary: str
    record: dict[str, Any]
    markdown_path: str | None
    created_at: int = field(default=0)


def _extract(events: list[Event]) -> dict[str, Any]:
    """Pull prompts, changed files, and tool counts from a session's events."""
    prompts: list[str] = []
    files: Counter[str] = Counter()
    tools: Counter[str] = Counter()
    for e in events:
        etype = e.get("event_type")
        if etype == "UserPromptSubmit":
            text = str(e.get("prompt") or e.get("tool_input", {}).get("prompt") or "").strip()
            if text:
                prompts.append(text)
        if etype in ("PreToolUse", "PostToolUse"):
            tool = e.get("tool_name")
            if tool:
                tools[str(tool)] += 1
            path = (e.get("tool_input") or {}).get("file_path")
            if path:
                files[str(path)] += 1
    return {
        # Every human prompt, in order, untruncated — the checkpoint is a record.
        "prompts": prompts,
        "files": [{"path": p, "edits": n} for p, n in files.most_common()],
        "tools": [{"tool": t, "count": n} for t, n in tools.most_common()],
        "event_count": len(events),
    }


def _git_state(cwd: Path) -> dict[str, Any]:
    if not (cwd / ".git").exists():
        return {"git": False, "path": str(cwd)}

    def git(*args: str) -> str:
        r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else ""

    return {
        "git": True,
        "repo": cwd.name,
        "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
        "dirty_files": [ln[3:] for ln in git("status", "--porcelain").splitlines()],
        "last_commit": git("log", "-1", "--oneline"),
    }


def build_checkpoint(
    *,
    session_key: str,
    label: str,
    cwd: Path,
    events: list[Event],
    intention: str,
    now_ms: int,
    since_ms: int = 0,
) -> Checkpoint:
    """Capture a checkpoint over `events`. If `since_ms` is set (the previous
    checkpoint's time), the record also breaks out the work done *since then* so
    the summary describes the delta, not the whole session again."""
    activity = _extract(events)
    git = _git_state(cwd)
    new_events = [e for e in events if int(e.get("_ts", 0)) > since_ms] if since_ms else events
    new_activity = _extract(new_events) if since_ms else activity
    record = {
        "intention": intention,
        **activity,
        **git,
        "created_at": now_ms,
        "since_ms": since_ms,
        "new_since_last": {
            "prompts": new_activity["prompts"],
            "files": new_activity["files"],
            "tools": new_activity["tools"],
            "event_count": new_activity["event_count"],
        },
    }
    summary = _summarize(intention, new_activity if since_ms else activity, git)
    markdown = _write_markdown(cwd, session_key, label, record, summary, now_ms)
    return Checkpoint(
        id=uuid.uuid4().hex,
        session_key=session_key,
        label=label,
        summary=summary,
        record=record,
        markdown_path=str(markdown) if markdown else None,
        created_at=now_ms,
    )


def _summarize(intention: str, activity: dict[str, Any], git: dict[str, Any]) -> str:
    facts = (
        f"{activity['event_count']} events; "
        f"{len(activity['files'])} files changed; "
        f"tools: {', '.join(f'{t['count']}x {t['tool']}' for t in activity['tools'][:5]) or 'none'}"
    )
    if git.get("git"):
        facts += f"; on {git['repo']}@{git['branch']}"
    prompt = (
        "Summarize what was done in this coding session in 2-3 sentences.\n\n"
        f"Intent: {intention or '(none)'}\n"
        f"Prompts given:\n" + "\n".join(f"- {p}" for p in activity["prompts"]) + "\n\n"
        f"Activity: {facts}"
    )
    result = summarize(prompt)
    return result.text or f"{intention or 'Session'} — {facts}."


def _write_markdown(
    cwd: Path,
    session_key: str,
    label: str,
    record: dict[str, Any],
    summary: str,
    now_ms: int,
) -> Path | None:
    dest = cwd / ".rubberduck" / "checkpoints" / session_key
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None

    def bullets(items: list[str]) -> list[str]:
        return items if items else ["(none)"]

    delta = record.get("new_since_last") or {}
    since_lines: list[str] = []
    if record.get("since_ms"):
        since_lines = [
            "## Since the last checkpoint",
            f"{delta.get('event_count', 0)} events, "
            f"{len(delta.get('files', []))} files changed.",
            "",
            "### New prompts",
            *bullets([f"- {p}" for p in delta.get("prompts", [])]),
            "",
        ]

    lines = [
        f"# Checkpoint: {label}",
        "",
        f"_{summary}_",
        "",
        "## Intent",
        record.get("intention") or "(none recorded)",
        "",
        *since_lines,
        "## All prompts this session",
        *bullets([f"- {p}" for p in record["prompts"]]),
        "",
        "## Files changed",
        *bullets([f"- {f['path']} ({f['edits']}x)" for f in record["files"]]),
        "",
        "## Tools",
        *bullets([f"- {t['count']}x {t['tool']}" for t in record["tools"]]),
        "",
        "## Git",
    ]
    if record.get("git"):
        lines += [
            f"- repo: {record['repo']}",
            f"- branch: {record['branch']}",
            f"- last commit: {record.get('last_commit') or '(none)'}",
            f"- uncommitted files: {len(record.get('dirty_files', []))}",
        ]
    else:
        lines.append(f"- not a git repo ({record.get('path')})")
    path = dest / f"checkpoint-{now_ms}.md"
    path.write_text("\n".join(lines) + "\n")
    (dest / "latest.md").write_text("\n".join(lines) + "\n")
    return path


def load_record(markdown_path: str) -> str:
    p = Path(markdown_path)
    return p.read_text() if p.is_file() else ""
