import { useCallback, useEffect, useState } from "react";
import { api, CheckpointRecord, RawEvent } from "./api";
import { LiveOutput } from "./LiveOutput";
import { effectiveState } from "./sessions";
import { SessionView } from "./types";
import { useToast } from "./ui";

type Tab = "timeline" | "output" | "diff" | "checkpoints" | "notes";

export function SessionDetail({
  session,
  onClose,
}: {
  session: SessionView;
  onClose: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("timeline");
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [diff, setDiff] = useState<string>("");
  const [capturing, setCapturing] = useState(false);
  // Jump-to-terminal applies to a launched session that's actually running
  // (we recorded its tab's tty; a stopped/archived/watched one has none to open).
  const liveState = effectiveState(session, Date.now());
  const canJumpToTerminal =
    session.launched &&
    liveState !== "terminated" &&
    liveState !== "stopped" &&
    liveState !== "archived";

  // Esc closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadCheckpoints = useCallback(() => {
    api
      .checkpoints(session.key)
      .then((d) => setCheckpoints(d.checkpoints))
      .catch(() => undefined);
  }, [session.key]);

  useEffect(() => {
    api
      .sessionEvents(session.key)
      .then((d) => setEvents(d.events))
      .catch(() => undefined);
    loadCheckpoints();
  }, [session.key, loadCheckpoints]);

  useEffect(() => {
    if (tab === "diff") {
      fetch(`/sessions/${session.key}/diff`)
        .then((r) => r.json())
        .then((d: { diff?: string; error?: string }) =>
          setDiff(d.error ? `git diff failed: ${d.error}` : (d.diff ?? "")),
        )
        .catch(() => setDiff(""));
    }
  }, [tab, session.key]);

  async function captureCheckpoint() {
    if (capturing) return;
    // Capturing runs a summarizer agent (claude -p / codex / copilot), which
    // takes a few seconds — show a loader so the click doesn't feel dead.
    setCapturing(true);
    try {
      await api.checkpoint(session.key, "manual");
      toast("Checkpoint recorded");
      loadCheckpoints();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 90,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 560,
          maxWidth: "94vw",
          background: "var(--card)",
          color: "var(--text)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.4)",
          zIndex: 91,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <strong style={{ fontSize: 16 }}>{session.label}</strong>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {canJumpToTerminal && (
                <button
                  className="rd-btn rd-btn-ghost rd-btn-sm"
                  title="Jump to this session's terminal tab"
                  style={{ lineHeight: 1 }}
                  onClick={async () => {
                    try {
                      await api.focusTerminal(session.key);
                    } catch (e) {
                      toast(
                        `Couldn't open terminal: ${(e as Error).message}`,
                        "err",
                      );
                    }
                  }}
                >
                  ↗ Terminal
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="Close"
                className="rd-btn rd-btn-ghost rd-btn-sm"
                style={{ lineHeight: 1 }}
              >
                ✕ Close
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            {session.state} · {session.runtime ?? "—"} · {session.eventCount}{" "}
            events
            {session.branch ? ` · ${session.branch}` : ""} · started{" "}
            {new Date(session.startedAt).toLocaleString()}
          </div>
          {session.intention && (
            <div
              style={{
                fontSize: 13,
                marginTop: 8,
                fontStyle: "italic",
                color: "#374151",
              }}
            >
              intent: {session.intention}
            </div>
          )}
          {session.outcome && (
            <div style={{ fontSize: 13, marginTop: 4, color: "#4b5563" }}>
              {session.outcome}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "8px 16px",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          {(
            [
              "timeline",
              // Diff is a plain git operation — show it for any session on a git
              // repo (a worktree, or run-in-place on a branch), not just
              // worktrees.
              ...(session.worktreePath || session.branch
                ? (["diff"] as Tab[])
                : []),
              // Output streams a PTY Rubberduck owns. Only the in-process
              // worktree-launch path has one; terminal-launched and watched
              // sessions run elsewhere, so there's nothing to stream.
              ...(session.worktreePath ? (["output"] as Tab[]) : []),
              "checkpoints",
              "notes",
            ] as Tab[]
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                border: "none",
                background: tab === t ? "#eff6ff" : "transparent",
                color: tab === t ? "#2563eb" : "#6b7280",
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 13,
                cursor: "pointer",
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {tab === "timeline" && <Timeline events={events} />}
          {tab === "output" && <LiveOutput sessionKey={session.key} />}
          {tab === "diff" && <DiffView diff={diff} />}
          {tab === "checkpoints" && (
            <Checkpoints
              checkpoints={checkpoints}
              onCapture={captureCheckpoint}
              capturing={capturing}
            />
          )}
          {tab === "notes" && <Notes sessionKey={session.key} />}
        </div>
      </div>
    </div>
  );
}

function Timeline({ events }: { events: RawEvent[] }) {
  if (events.length === 0)
    return <Empty text="No events recorded for this session." />;
  return (
    <div>
      {events.map((e) => (
        <div
          key={e._id}
          style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 13 }}
        >
          <span
            style={{
              color: "#9ca3af",
              fontVariantNumeric: "tabular-nums",
              minWidth: 64,
            }}
          >
            {new Date(e._ts).toLocaleTimeString()}
          </span>
          <span style={{ fontWeight: 500 }}>{e.event_type}</span>
          {e.tool_name && (
            <span style={{ color: "#2563eb" }}>{e.tool_name}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  if (!diff)
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
        <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text)" }}>
          Diff — stay tuned.
        </p>
        <p style={{ margin: 0 }}>
          This shows uncommitted changes in the session&apos;s working tree.
          Showing a full diff of everything the session changed (including
          commits, vs. its base branch) is coming soon.
        </p>
      </div>
    );
  return (
    <pre
      style={{
        fontSize: 12,
        lineHeight: 1.5,
        margin: 0,
        whiteSpace: "pre-wrap",
      }}
    >
      {diff.split("\n").map((line, i) => (
        <div
          key={i}
          style={{
            color: line.startsWith("+")
              ? "#16a34a"
              : line.startsWith("-")
                ? "#dc2626"
                : "#374151",
            background: line.startsWith("@@") ? "#eff6ff" : "transparent",
          }}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

function Checkpoints({
  checkpoints,
  onCapture,
  capturing,
}: {
  checkpoints: CheckpointRecord[];
  onCapture: () => void;
  capturing: boolean;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13, color: "#565869" }}>
          A record of what was done — prompts, files, tools, git state.
        </span>
        <button
          className="rd-btn rd-btn-sm rd-btn-ghost"
          onClick={onCapture}
          disabled={capturing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            whiteSpace: "nowrap",
            opacity: capturing ? 0.7 : 1,
            cursor: capturing ? "default" : "pointer",
          }}
        >
          {capturing && <Spinner />}
          {capturing ? "Capturing…" : "Capture now"}
        </button>
      </div>
      {capturing && <CapturingCard />}
      {checkpoints.length === 0 && !capturing ? (
        <Empty text="No checkpoints recorded yet." />
      ) : (
        checkpoints.map((c) => <CheckpointCard key={c.id} c={c} />)
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        display: "inline-block",
        animation: "rd-spin 0.7s linear infinite",
      }}
    />
  );
}

function CapturingCard() {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: "#565869",
        fontSize: 13,
      }}
    >
      <Spinner />
      Capturing checkpoint — summarizing this session…
    </div>
  );
}

function CheckpointCard({ c }: { c: CheckpointRecord }) {
  const [open, setOpen] = useState(false);
  const r = c.record;
  return (
    <div style={{ borderBottom: "1px solid #f0f0f2", padding: "12px 0" }}>
      <div style={{ cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <strong style={{ fontSize: 13 }}>{c.label}</strong>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            {new Date(c.created_at).toLocaleString()}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>
          {c.summary}
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "#565869" }}>
          {r.git && (
            <div style={{ marginBottom: 8 }}>
              <strong>Git:</strong> {r.repo} · {r.branch}
            </div>
          )}
          {r.prompts.length > 0 && (
            <Section title="Prompts">
              {r.prompts.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </Section>
          )}
          {r.files.length > 0 && (
            <Section title="Files changed">
              {r.files.map((f, i) => (
                <li key={i}>
                  {f.path} ({f.edits}×)
                </li>
              ))}
            </Section>
          )}
          {r.tools.length > 0 && (
            <Section title="Tools">
              {r.tools.map((t, i) => (
                <li key={i}>
                  {t.count}× {t.tool}
                </li>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{children}</ul>
    </div>
  );
}

// Notes are a list of entries, stored newline-separated in the session's
// `notes` column. Each non-empty line is one note.
function parseNotes(raw: string | null | undefined): string[] {
  return (raw ?? "").split("\n").filter((l) => l.trim() !== "");
}

function Notes({ sessionKey }: { sessionKey: string }) {
  const toast = useToast();
  const [notes, setNotes] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Fetch the saved notes fresh when this tab opens — don't trust the cached
  // session view, which live events can strip.
  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .getSession(sessionKey)
      .then((s) => {
        if (live) setNotes(parseNotes(s.notes));
      })
      .catch((e) => {
        if (live) toast(`Couldn't load notes: ${(e as Error).message}`, "err");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [sessionKey, toast]);

  async function persist(nextNotes: string[]): Promise<boolean> {
    setBusy(true);
    try {
      await api.updateSession(sessionKey, { notes: nextNotes.join("\n") });
      setNotes(nextNotes);
      return true;
    } catch {
      toast("Couldn't save note", "err");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    const entry = draft.trim();
    if (!entry) return;
    if (await persist([...notes, entry])) {
      setDraft("");
      toast("Note added");
    }
  }

  async function removeNote(index: number) {
    await persist(notes.filter((_, i) => i !== index));
  }

  if (loading)
    return (
      <p style={{ fontSize: 13, color: "var(--muted)" }}>Loading notes…</p>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft)" }}>
        Your private notes for this session — things to do, reminders, context.
        Local only, never sent anywhere.
      </p>

      {notes.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          No notes yet. Add one below.
        </p>
      ) : (
        <ul
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            margin: 0,
            padding: 0,
            listStyle: "none",
          }}
        >
          {notes.map((note, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg-soft)",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  flex: 1,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {note}
              </span>
              <button
                className="rd-btn rd-btn-sm rd-btn-ghost"
                onClick={() => removeNote(i)}
                disabled={busy}
                title="Delete this note"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addNote();
          }}
          placeholder="Add a note and press Enter…"
          style={{
            flex: 1,
            padding: "8px 10px",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "inherit",
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />
        <button
          className="rd-btn rd-btn-sm rd-btn-primary"
          onClick={addNote}
          disabled={busy || draft.trim() === ""}
        >
          Add note
        </button>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ color: "#9ca3af", fontSize: 13 }}>{text}</p>;
}
