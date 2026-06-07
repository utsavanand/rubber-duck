import { useCallback, useEffect, useState } from "react";
import { api, RawEvent } from "./api";
import { LiveOutput } from "./LiveOutput";
import { SessionView } from "./types";
import { Button, useToast } from "./ui";

type Tab = "timeline" | "output" | "diff" | "checkpoints";

interface Checkpoint {
  commit_sha: string;
  label: string;
  created_at: number;
}

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
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [diff, setDiff] = useState<string>("");

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
        .then((d: { diff: string }) => setDiff(d.diff))
        .catch(() => setDiff(""));
    }
  }, [tab, session.key]);

  async function rollback(commit: string) {
    try {
      await api.rollback(session.key, commit);
      toast(`Rolled back to ${commit.slice(0, 8)}`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 560,
        maxWidth: "94vw",
        background: "#fff",
        borderLeft: "1px solid #e5e7eb",
        boxShadow: "-12px 0 40px rgba(0,0,0,0.12)",
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <strong style={{ fontSize: 16 }}>{session.label}</strong>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "none",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
          {session.state} · {session.runtime ?? "—"} · {session.eventCount}{" "}
          events
          {session.branch ? ` · ${session.branch}` : ""}
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
        {(["timeline", "output", "diff", "checkpoints"] as Tab[]).map((t) => (
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
          <Checkpoints checkpoints={checkpoints} onRollback={rollback} />
        )}
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
      <Empty text="No changes in this session's worktree (or diff unavailable)." />
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
  onRollback,
}: {
  checkpoints: Checkpoint[];
  onRollback: (commit: string) => void;
}) {
  if (checkpoints.length === 0) return <Empty text="No checkpoints yet." />;
  return (
    <div>
      {checkpoints.map((c) => (
        <div
          key={c.commit_sha}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 0",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <div>
            <div style={{ fontSize: 14 }}>{c.label}</div>
            <code style={{ fontSize: 11, color: "#9ca3af" }}>
              {c.commit_sha.slice(0, 10)}
            </code>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRollback(c.commit_sha)}
          >
            Roll back
          </Button>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ color: "#9ca3af", fontSize: 13 }}>{text}</p>;
}
