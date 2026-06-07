import { useEffect, useState } from "react";
import { api } from "./api";
import { CompareModal } from "./CompareModal";
import { ForkTree } from "./ForkTree";
import { LaunchModal } from "./LaunchModal";
import { SessionDetail } from "./SessionDetail";
import { SnapshotsModal } from "./SnapshotsModal";
import { SessionView } from "./types";
import { Button, ToastProvider, useToast } from "./ui";
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

function SessionCard({
  session,
  now,
  onOpen,
}: {
  session: SessionView;
  now: number;
  onOpen: () => void;
}) {
  const toast = useToast();
  const color = STATE_COLOR[session.state] ?? "#6b7280";
  const live = session.state !== "terminated";

  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast(`${label} ✓`);
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`, "err");
    }
  }

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: "12px 16px",
        width: 300,
      }}
    >
      <div
        onClick={onOpen}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          cursor: "pointer",
        }}
      >
        <strong>{session.label}</strong>
        <span style={{ color, fontSize: 13, textTransform: "uppercase" }}>
          {session.state === "waiting" ? "waiting on you" : session.state}
        </span>
      </div>
      {session.compareGroup && (
        <div
          style={{
            display: "inline-block",
            marginTop: 6,
            padding: "1px 6px",
            fontSize: 11,
            borderRadius: 4,
            background: "#ede9fe",
            color: "#6d28d9",
          }}
        >
          compare: {session.compareGroup}
        </div>
      )}
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
      {session.branch && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
          ⎇ {session.branch}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Open
        </Button>
        {session.branch && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              act("Forked", () => api.fork(session.key, { command: "true" }))
            }
          >
            Fork
          </Button>
        )}
        {session.branch && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              act("Checkpointed", () => api.checkpoint(session.key, "manual"))
            }
          >
            Checkpoint
          </Button>
        )}
        {session.branch && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              act("Spotlighted to main", () => api.spotlight(session.key))
            }
          >
            Spotlight
          </Button>
        )}
        {live && (
          <Button
            size="sm"
            variant="danger"
            onClick={() => act("Stopped", () => api.stop(session.key))}
          >
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}

function Dashboard() {
  const { sessions, connected } = useEventStream();
  const now = useNow(1000);
  const [modal, setModal] = useState<"launch" | "compare" | "snapshots" | null>(
    null,
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openSession = sessions.find((s) => s.key === openKey) ?? null;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>Rubberduck</h1>
        <span
          style={{ color: connected ? "#16a34a" : "#dc2626", fontSize: 13 }}
        >
          {connected ? "● live" : "○ disconnected"}
        </span>
        <div style={{ flex: 1 }} />
        <Button onClick={() => setModal("launch")}>+ New session</Button>
        <Button variant="ghost" onClick={() => setModal("compare")}>
          Compare
        </Button>
        <Button variant="ghost" onClick={() => setModal("snapshots")}>
          Snapshots
        </Button>
      </header>

      {sessions.length === 0 ? (
        <p style={{ color: "#6b7280" }}>
          No sessions yet. Click <strong>+ New session</strong> to launch an
          agent, or run Claude Code in a hooked repo.
        </p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {sessions.map((s) => (
            <SessionCard
              key={s.key}
              session={s}
              now={now}
              onOpen={() => setOpenKey(s.key)}
            />
          ))}
        </div>
      )}

      <ForkTree refreshKey={sessions.length} />

      {modal === "launch" && <LaunchModal onClose={() => setModal(null)} />}
      {modal === "compare" && <CompareModal onClose={() => setModal(null)} />}
      {modal === "snapshots" && (
        <SnapshotsModal
          sessionKeys={sessions.map((s) => s.key)}
          onClose={() => setModal(null)}
        />
      )}
      {openSession && (
        <SessionDetail session={openSession} onClose={() => setOpenKey(null)} />
      )}
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}
