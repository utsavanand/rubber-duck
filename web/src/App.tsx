import { useEffect, useMemo, useState } from "react";
import { AgentTree } from "./AgentTree";
import { api } from "./api";
import { Approvals } from "./Approvals";
import { CompareModal } from "./CompareModal";
import { ForkModal } from "./ForkModal";
import { LaunchModal } from "./LaunchModal";
import { Pulse } from "./Pulse";
import { SessionDetail } from "./SessionDetail";
import { SnapshotsModal } from "./SnapshotsModal";
import { effectiveState } from "./sessions";
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

type Filter = "active" | "idle" | "all";

function Dashboard() {
  const { sessions, connected, recentEvents, removeSessions } =
    useEventStream();
  const toast = useToast();
  const now = useNow(1000);
  const { theme, cycle: cycleTheme } = useTheme();

  async function deleteSession(key: string) {
    try {
      let res = await api.remove(key);
      // 409: the worktree branch has commits not in main — deleting drops that
      // agent work. Confirm before forcing.
      if (res.status === 409 && res.unmerged_commits) {
        const ok = window.confirm(
          `Branch ${res.branch} has ${res.unmerged_commits} commit(s) not merged into main. ` +
            `Delete anyway and discard that work?`,
        );
        if (!ok) return;
        res = await api.remove(key, true);
      }
      removeSessions([key]);
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

  const [filter, setFilter] = useState<Filter>("active");
  const [modal, setModal] = useState<"launch" | "compare" | "snapshots" | null>(
    null,
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [forkKey, setForkKey] = useState<string | null>(null);

  const openSession = sessions.find((s) => s.key === openKey) ?? null;
  const forkSession = sessions.find((s) => s.key === forkKey) ?? null;

  const labels = useMemo(
    () => Object.fromEntries(sessions.map((s) => [s.key, s.label])),
    [sessions],
  );

  const isActive = (s: SessionView) => {
    const st = effectiveState(s, now);
    return st === "busy" || st === "waiting";
  };
  const isIdle = (s: SessionView) => effectiveState(s, now) === "idle";
  const activeCount = sessions.filter(isActive).length;
  const idleCount = sessions.filter(isIdle).length;
  const shown =
    filter === "active"
      ? sessions.filter(isActive)
      : filter === "idle"
        ? sessions.filter(isIdle)
        : sessions;
  const hasTerminated = sessions.some((s) => s.state === "terminated");

  return (
    <div className="rd-app">
      <header className="rd-topbar">
        <span className="rd-brand">
          <span>🦆</span> RubberDuckHQ
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
          className="rd-btn rd-btn-ghost rd-btn-sm"
          onClick={() => setModal("compare")}
          title="Run one prompt across multiple agents"
        >
          Compare
        </button>
        <button
          className="rd-btn rd-btn-ghost rd-btn-sm"
          onClick={() => setModal("snapshots")}
        >
          Snapshots
        </button>
        <button
          className="rd-btn rd-btn-primary"
          onClick={() => setModal("launch")}
        >
          New session
        </button>
      </header>

      <div className="rd-panels">
        <section className="rd-agents">
          <div className="rd-panel-head">
            <span>Agents</span>
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
          </div>
          {shown.length === 0 ? (
            <p className="rd-panel-empty">
              {sessions.length === 0
                ? "No agents yet. Launch one, or run Claude Code in a hooked repo."
                : "Nothing here. Switch to All to see terminated agents."}
            </p>
          ) : (
            <AgentTree
              sessions={shown}
              now={now}
              labels={labels}
              onOpen={setOpenKey}
              onFork={setForkKey}
              onDelete={deleteSession}
            />
          )}
          {hasTerminated && filter === "all" && (
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              style={{ margin: 12 }}
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
        </section>

        <section className="rd-attention">
          <div className="rd-panel-head">
            <span>Needs you</span>
          </div>
          <div className="rd-attention-body">
            <Approvals labels={labels} pollKey={sessions.length} />
          </div>
        </section>

        <Pulse events={recentEvents} labels={labels} />
      </div>

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
