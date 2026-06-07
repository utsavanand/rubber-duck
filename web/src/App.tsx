import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Approvals } from "./Approvals";
import { CompareModal } from "./CompareModal";
import { ForkModal } from "./ForkModal";
import { ForkTree } from "./ForkTree";
import { LaunchModal } from "./LaunchModal";
import { SessionDetail } from "./SessionDetail";
import { SnapshotsModal } from "./SnapshotsModal";
import { SessionView } from "./types";
import { ToastProvider, useToast } from "./ui";
import { useEventStream } from "./useEventStream";
import { useTheme } from "./useTheme";

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
  parentLabel,
  onOpen,
  onFork,
  onDelete,
}: {
  session: SessionView;
  now: number;
  parentLabel?: string;
  onOpen: () => void;
  onFork: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const live = session.state !== "terminated";

  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast(label);
    } catch (e) {
      toast(`${label} failed: ${(e as Error).message}`, "err");
    }
  }

  const stateLabel =
    session.state === "waiting" ? "waiting on you" : session.state;

  return (
    <div className={`rd-card${live ? "" : " terminated"}`}>
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
      {session.parentKey && (
        <div className="sub">
          ↳ forked from {parentLabel ?? session.parentKey.slice(0, 8)}
        </div>
      )}
      <div className="sub mono">
        {session.branch ? (
          <>
            {session.repoName ?? "repo"} · {session.branch}
          </>
        ) : (
          (session.cwd ?? "—")
        )}
      </div>
      {session.worktreePath && (
        <div className="sub mono" style={{ opacity: 0.7 }}>
          worktree: {session.worktreePath}
        </div>
      )}

      <div className="rd-actions">
        <button className="rd-btn rd-btn-sm rd-btn-ghost" onClick={onOpen}>
          Open
        </button>
        {/* Checkpoint records what was done — works for any session. */}
        <button
          className="rd-btn rd-btn-sm rd-btn-ghost"
          title="Record what was done so far (prompts, files, tools, git)"
          onClick={() =>
            act("Checkpoint recorded", () =>
              api.checkpoint(session.key, "manual"),
            )
          }
        >
          Checkpoint
        </button>
        {/* Worktree actions need a git branch. */}
        {session.branch && live && (
          <>
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              title="Branch the code: new worktree + branch off this one"
              onClick={onFork}
            >
              Fork worktree
            </button>
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              title="Copy this session's changes onto your main checkout to test there"
              onClick={() =>
                act("Spotlighted to main", () => api.spotlight(session.key))
              }
            >
              Spotlight
            </button>
          </>
        )}
        {/* Conversation fork only makes sense for a claude-code session. */}
        {session.runtime === "claude-code" && live && (
          <button
            className="rd-btn rd-btn-sm rd-btn-ghost"
            title="Open the forked conversation in a new terminal: claude --resume … --fork-session"
            onClick={async () => {
              try {
                const r = await api.forkConversation(session.key);
                if (r.opened_in_terminal) {
                  toast("Opened forked conversation in a new terminal");
                } else {
                  toast(`Run this yourself: ${r.command}`, "err");
                }
              } catch (e) {
                toast(
                  `Fork conversation failed: ${(e as Error).message}`,
                  "err",
                );
              }
            }}
          >
            Fork conversation
          </button>
        )}
        {live && (
          <button
            className="rd-btn rd-btn-sm rd-btn-danger"
            onClick={() => act("Stopped", () => api.stop(session.key))}
          >
            Stop
          </button>
        )}
        <button
          className="rd-btn rd-btn-sm rd-btn-danger"
          title="Remove this session from history"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

type Tab = "sessions" | "tree";
type Filter = "active" | "idle" | "all";

function Dashboard() {
  const { sessions, connected, removeSessions } = useEventStream();
  const toast = useToast();
  const now = useNow(1000);
  const { theme, cycle: cycleTheme } = useTheme();

  async function deleteSession(key: string) {
    try {
      await api.remove(key);
      removeSessions([key]); // drop it from the grid immediately
      toast("Deleted");
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "err");
    }
  }

  async function clearTerminated(terminatedKeys: string[]) {
    try {
      const r = await api.clearTerminated();
      removeSessions(terminatedKeys);
      toast(
        `Cleared ${r.cleared} terminated session${r.cleared === 1 ? "" : "s"}`,
      );
    } catch (e) {
      toast(`Clear failed: ${(e as Error).message}`, "err");
    }
  }
  const [tab, setTab] = useState<Tab>("sessions");
  const [filter, setFilter] = useState<Filter>("active");
  const [modal, setModal] = useState<"launch" | "compare" | "snapshots" | null>(
    null,
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [forkKey, setForkKey] = useState<string | null>(null);

  const openSession = sessions.find((s) => s.key === openKey) ?? null;
  const forkSession = sessions.find((s) => s.key === forkKey) ?? null;

  // session key -> human label, so approvals show names not IDs.
  const labels = useMemo(
    () => Object.fromEntries(sessions.map((s) => [s.key, s.label])),
    [sessions],
  );

  // Active = busy or waiting (working / needs you); Idle = quiet but alive.
  const activeCount = sessions.filter(
    (s) => s.state === "busy" || s.state === "waiting",
  ).length;
  const idleCount = sessions.filter((s) => s.state === "idle").length;
  const shown =
    filter === "active"
      ? sessions.filter((s) => s.state === "busy" || s.state === "waiting")
      : filter === "idle"
        ? sessions.filter((s) => s.state === "idle")
        : sessions;

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
          className="rd-btn rd-btn-ghost rd-btn-sm"
          title={`Theme: ${theme} (click to change)`}
          onClick={cycleTheme}
          aria-label="Toggle theme"
        >
          {theme === "light" ? "☀︎" : theme === "dark" ? "☾" : "◐"}
        </button>
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

      <Approvals labels={labels} pollKey={sessions.length} />

      <nav className="rd-tabs">
        <button
          className={`rd-tab${tab === "sessions" ? " active" : ""}`}
          onClick={() => setTab("sessions")}
        >
          Sessions <span className="count">{activeCount}</span>
        </button>
        <button
          className={`rd-tab${tab === "tree" ? " active" : ""}`}
          onClick={() => setTab("tree")}
        >
          Fork tree
        </button>
      </nav>

      {tab === "sessions" && (
        <>
          <div className="rd-filterbar">
            <div className="rd-segment">
              <button
                className={filter === "active" ? "active" : ""}
                onClick={() => setFilter("active")}
              >
                Active ({activeCount})
              </button>
              <button
                className={filter === "idle" ? "active" : ""}
                onClick={() => setFilter("idle")}
              >
                Idle ({idleCount})
              </button>
              <button
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
              >
                All ({sessions.length})
              </button>
            </div>
            <span className="rd-spacer" />
            {sessions.some((s) => s.state === "terminated") && (
              <button
                className="rd-btn rd-btn-sm rd-btn-ghost"
                title="Delete all terminated sessions from history"
                onClick={() =>
                  clearTerminated(
                    sessions
                      .filter((s) => s.state === "terminated")
                      .map((s) => s.key),
                  )
                }
              >
                Clear terminated
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="rd-empty">
              {sessions.length === 0 ? (
                <>
                  No sessions yet. Click <strong>New session</strong> to launch
                  an agent, or run Claude Code in a hooked repo.
                </>
              ) : (
                "No active sessions. Switch to All to see terminated ones."
              )}
            </p>
          ) : (
            <div className="rd-grid">
              {shown.map((s) => (
                <SessionCard
                  key={s.key}
                  session={s}
                  now={now}
                  parentLabel={s.parentKey ? labels[s.parentKey] : undefined}
                  onOpen={() => setOpenKey(s.key)}
                  onFork={() => setForkKey(s.key)}
                  onDelete={() => deleteSession(s.key)}
                />
              ))}
            </div>
          )}

          <div style={{ marginTop: 28 }}>
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              onClick={() => setModal("compare")}
              title="Run one prompt across multiple agents"
            >
              Compare models
            </button>
          </div>
        </>
      )}

      {tab === "tree" && <ForkTree refreshKey={sessions.length} />}

      {modal === "launch" && <LaunchModal onClose={() => setModal(null)} />}
      {modal === "compare" && <CompareModal onClose={() => setModal(null)} />}
      {modal === "snapshots" && (
        <SnapshotsModal
          sessionKeys={sessions.map((s) => s.key)}
          onClose={() => setModal(null)}
        />
      )}
      {forkSession && (
        <ForkModal session={forkSession} onClose={() => setForkKey(null)} />
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
