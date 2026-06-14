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

type Filter = "active" | "idle" | "watched" | "launched" | "archived" | "all";

function Dashboard() {
  const { sessions, connected, recentEvents, removeSessions } =
    useEventStream();
  const toast = useToast();
  const now = useNow(1000);
  const { theme, cycle: cycleTheme } = useTheme();

  async function deleteSession(key: string): Promise<boolean> {
    try {
      let res = await api.remove(key);
      // 409: the worktree branch has commits not in main — deleting drops that
      // agent work. Confirm before forcing.
      if (res.status === 409 && res.unmerged_commits) {
        const ok = window.confirm(
          `Branch ${res.branch} has ${res.unmerged_commits} commit(s) not merged into main. ` +
            `Delete anyway and discard that work?`,
        );
        if (!ok) return false;
        res = await api.remove(key, true);
      }
      removeSessions([key]);
      toast("Deleted");
      return true;
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "err");
      return false;
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
  // Which session keys have a row — Pulse/Approvals rows are clickable only for
  // these, since the detail drawer reads from the live session list.
  const knownKeys = useMemo(
    () => new Set(sessions.map((s) => s.key)),
    [sessions],
  );

  const isActive = (s: SessionView) => {
    const st = effectiveState(s, now);
    return st === "busy" || st === "waiting";
  };
  const isIdle = (s: SessionView) => effectiveState(s, now) === "idle";
  const isArchived = (s: SessionView) => effectiveState(s, now) === "archived";
  // Archived sessions are put away — they only show under the Archived filter,
  // never in the active/idle/watched/launched/all views.
  const visible = sessions.filter((s) => !isArchived(s));
  const activeCount = visible.filter(isActive).length;
  const idleCount = visible.filter(isIdle).length;
  const watchedCount = visible.filter((s) => !s.launched).length;
  const launchedCount = visible.filter((s) => s.launched).length;
  const archivedCount = sessions.filter(isArchived).length;
  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: "active", label: "Active", count: activeCount },
    { key: "idle", label: "Idle", count: idleCount },
    { key: "watched", label: "Watched", count: watchedCount },
    { key: "launched", label: "Launched", count: launchedCount },
    { key: "archived", label: "Archived", count: archivedCount },
    { key: "all", label: "All", count: visible.length },
  ];
  const shown =
    filter === "active"
      ? visible.filter(isActive)
      : filter === "idle"
        ? visible.filter(isIdle)
        : filter === "watched"
          ? visible.filter((s) => !s.launched)
          : filter === "launched"
            ? visible.filter((s) => s.launched)
            : filter === "archived"
              ? sessions.filter(isArchived)
              : visible;
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
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={filter === f.key ? "active" : ""}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} ({f.count})
                </button>
              ))}
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
            <span>Needs human</span>
          </div>
          <div className="rd-attention-body">
            <Approvals
              labels={labels}
              pollKey={sessions.length}
              onOpen={setOpenKey}
              knownKeys={knownKeys}
              waiting={sessions.filter(
                (s) => effectiveState(s, now) === "waiting",
              )}
            />
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
