import { useEffect, useState } from "react";
import { api } from "./api";
import { Approvals } from "./Approvals";
import { CompareModal } from "./CompareModal";
import { ForkTree } from "./ForkTree";
import { LaunchModal } from "./LaunchModal";
import { SessionDetail } from "./SessionDetail";
import { SnapshotsModal } from "./SnapshotsModal";
import { SessionView } from "./types";
import { ToastProvider, useToast } from "./ui";
import { useEventStream } from "./useEventStream";

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
  const live = session.state !== "terminated";

  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast(`${label}`);
    } catch (e) {
      toast(`${label} failed: ${(e as Error).message}`, "err");
    }
  }

  const stateLabel =
    session.state === "waiting" ? "waiting on you" : session.state;

  return (
    <div className="rd-card">
      <div className="head" onClick={onOpen}>
        <span className="name">{session.label}</span>
        <span className={`rd-state st-${session.state}`}>
          <span className="dot" />
          {stateLabel}
        </span>
      </div>
      {session.compareGroup && (
        <span className="rd-chip">compare · {session.compareGroup}</span>
      )}
      <div className="line">
        {session.lastEventType}
        {session.lastTool ? ` · ${session.lastTool}` : ""}
      </div>
      <div className="sub">
        up {uptime(session.startedAt, now)} · {session.eventCount} events
        {session.metrics?.build ? ` · ${session.metrics.build} builds` : ""}
        {session.metrics?.test ? ` · ${session.metrics.test} tests` : ""}
      </div>
      {session.intention && <div className="intent">{session.intention}</div>}
      {session.branch && <div className="sub mono">⎇ {session.branch}</div>}

      <div className="rd-actions">
        <button className="rd-btn rd-btn-sm rd-btn-ghost" onClick={onOpen}>
          Open
        </button>
        {session.branch && (
          <>
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              onClick={() =>
                act("Forked", () => api.fork(session.key, { command: "true" }))
              }
            >
              Fork
            </button>
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              onClick={() =>
                act("Checkpointed", () => api.checkpoint(session.key, "manual"))
              }
            >
              Checkpoint
            </button>
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              onClick={() =>
                act("Spotlighted to main", () => api.spotlight(session.key))
              }
            >
              Spotlight
            </button>
          </>
        )}
        {live && (
          <button
            className="rd-btn rd-btn-sm rd-btn-danger"
            onClick={() => act("Stopped", () => api.stop(session.key))}
          >
            Stop
          </button>
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
    <div className="rd-app">
      <header className="rd-topbar">
        <span className="rd-brand">
          <span>🦆</span> Rubberduck
        </span>
        <span className="rd-live">
          <span className={`dot ${connected ? "on" : "off"}`} />
          {connected ? "Live" : "Disconnected"}
        </span>
        <span className="rd-spacer" />
        <button
          className="rd-btn rd-btn-primary"
          onClick={() => setModal("launch")}
        >
          New session
        </button>
        <button
          className="rd-btn rd-btn-ghost"
          onClick={() => setModal("snapshots")}
        >
          Snapshots
        </button>
      </header>

      <Approvals pollKey={sessions.length} />

      {sessions.length === 0 ? (
        <p className="rd-empty">
          No sessions yet. Click <strong>New session</strong> to launch an
          agent, or run Claude Code in a hooked repo.
        </p>
      ) : (
        <>
          <div className="rd-section-title">Sessions</div>
          <div className="rd-grid">
            {sessions.map((s) => (
              <SessionCard
                key={s.key}
                session={s}
                now={now}
                onOpen={() => setOpenKey(s.key)}
              />
            ))}
          </div>
        </>
      )}

      <ForkTree refreshKey={sessions.length} />

      <div style={{ marginTop: 32 }}>
        <button
          className="rd-btn rd-btn-sm rd-btn-ghost"
          onClick={() => setModal("compare")}
          title="Run one prompt across multiple agents"
        >
          Compare models
        </button>
      </div>

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
