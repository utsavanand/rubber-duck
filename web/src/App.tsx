import { useEffect, useState } from "react";
import { ForkTree } from "./ForkTree";
import { SessionView } from "./types";
import { useEventStream } from "./useEventStream";

const STATE_COLOR: Record<string, string> = {
  busy: "#2563eb",
  idle: "#16a34a",
  waiting: "#d97706",
  terminated: "#6b7280",
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function uptime(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function SessionCard({ session, now }: { session: SessionView; now: number }) {
  const color = STATE_COLOR[session.state] ?? "#6b7280";
  return (
    <div
      style={{
        border: `1px solid #e5e7eb`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: "12px 16px",
        minWidth: 240,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <strong>{session.label}</strong>
        <span style={{ color, fontSize: 13, textTransform: "uppercase" }}>
          {session.state === "waiting" ? "waiting on you" : session.state}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#374151", marginTop: 6 }}>
        {session.lastEventType}
        {session.lastTool ? ` · ${session.lastTool}` : ""}
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
        up {uptime(session.startedAt, now)} · {session.eventCount} events
        {session.metrics?.build ? ` · ${session.metrics.build} builds` : ""}
        {session.metrics?.test ? ` · ${session.metrics.test} tests` : ""}
      </div>
      {session.intention && (
        <div
          style={{
            fontSize: 12,
            color: "#374151",
            marginTop: 6,
            fontStyle: "italic",
          }}
        >
          intent: {session.intention}
        </div>
      )}
      {session.outcome && (
        <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>
          {session.outcome}
        </div>
      )}
      {session.cwd && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
          {session.cwd}
        </div>
      )}
    </div>
  );
}

export function App() {
  const { sessions, connected } = useEventStream();
  const now = useNow(1000);
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0 }}>Rubberduck</h1>
        <span
          style={{ color: connected ? "#16a34a" : "#dc2626", fontSize: 13 }}
        >
          {connected ? "● live" : "○ disconnected"}
        </span>
      </header>
      {sessions.length === 0 ? (
        <p style={{ color: "#6b7280" }}>
          No sessions yet. POST an event to /events to see one here.
        </p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {sessions.map((s) => (
            <SessionCard key={s.key} session={s} now={now} />
          ))}
        </div>
      )}
      <ForkTree refreshKey={sessions.length} />
    </div>
  );
}
