"""Turn a session's transcript (or its raw PTY log) into a one-paragraph
outcome summary. Three backends, selected by env:

    RUBBERDUCK_SUMMARIZER_CMD   a shell command fed the prompt on stdin
                                (default if set, e.g. "claude -p --bare")
    RUBBERDUCK_SUMMARIZER_URL   POST {prompt} -> {text}
    (neither set)               mechanical fallback: no LLM, a fact-only summary

The fallback always works with zero configuration and zero API key, so a fresh
install still records *something* useful at session end.
"""

import json
import os
import subprocess
import urllib.request
from dataclasses import dataclass


@dataclass
class Summary:
    text: str
    backend: str


def summarize(prompt: str) -> Summary:
    cmd = os.environ.get("RUBBERDUCK_SUMMARIZER_CMD")
    if cmd:
        return _cli_summary(cmd, prompt)
    url = os.environ.get("RUBBERDUCK_SUMMARIZER_URL")
    if url:
        return _http_summary(url, prompt)
    return Summary(text="", backend="none")


def _cli_summary(cmd: str, prompt: str) -> Summary:
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return Summary(text="", backend="none")
    if result.returncode != 0:
        return Summary(text="", backend="none")
    return Summary(text=result.stdout.strip(), backend="cli")


def _http_summary(url: str, prompt: str) -> Summary:
    req = urllib.request.Request(
        url,
        data=json.dumps({"prompt": prompt}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        body = urllib.request.urlopen(req, timeout=60).read()
        text = str(json.loads(body).get("text", "")).strip()
    except (OSError, json.JSONDecodeError):
        return Summary(text="", backend="none")
    return Summary(text=text, backend="http")


def build_prompt(intention: str, transcript: str, events_summary: str) -> str:
    return (
        "Summarize this AI coding session in 2-3 sentences: what was the intent, "
        "what was done, and the outcome.\n\n"
        f"Intent: {intention or '(none recorded)'}\n\n"
        f"Activity: {events_summary}\n\n"
        f"Transcript (may be empty):\n{transcript[:4000]}"
    )


def mechanical_summary(intention: str, events_summary: str) -> str:
    """The no-LLM fallback: state the intent and the raw activity counts."""
    intent = intention or "no stated intent"
    return f"Intent: {intent}. {events_summary}"
