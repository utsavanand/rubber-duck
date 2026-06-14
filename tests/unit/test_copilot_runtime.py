import sqlite3
from pathlib import Path

from rubberduck.runtimes.copilot import CopilotRuntime


def test_read_transcript_from_turns_table(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    home = tmp_path
    db_dir = home / ".copilot"
    db_dir.mkdir()
    db = db_dir / "session-store.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE turns (id INTEGER, session_id TEXT, turn_index INTEGER, "
        "user_message TEXT, assistant_response TEXT, timestamp TEXT)"
    )
    conn.executemany(
        "INSERT INTO turns (session_id, turn_index, user_message, assistant_response) "
        "VALUES (?, ?, ?, ?)",
        [
            ("s1", 0, "add a healthcheck", "Added GET /health returning 200."),
            ("s1", 1, "now test it", "Wrote a test; it passes."),
            ("other", 0, "different session", "ignored"),
        ],
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    records = CopilotRuntime().read_transcript(cwd=tmp_path, session_id="s1")
    assert records == [
        {"role": "user", "text": "add a healthcheck"},
        {"role": "assistant", "text": "Added GET /health returning 200."},
        {"role": "user", "text": "now test it"},
        {"role": "assistant", "text": "Wrote a test; it passes."},
    ]


def test_read_transcript_empty_when_no_db(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    assert CopilotRuntime().read_transcript(cwd=tmp_path, session_id="s1") == []
