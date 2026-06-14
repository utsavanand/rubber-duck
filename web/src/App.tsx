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

// Two orthogonal axes: lifecycle (where a session is in its life) and origin
// (whether Rubberduck launched it or is just watching). They combine — e.g.
// "active" + "watched" shows active sessions you started yourself.
type Lifecycle = "active" | "idle" | "archived" | "all";
type Origin = "all" | "watched" | "launched";

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
    const n = terminatedKeys.length;
    // Double-confirm: this permanently drops terminated sessions from history.
    if (
      !window.confirm(
        `Clear ${n} terminated session${n === 1 ? "" : "s"} from history?`,
      )
    )
      return;
    if (
      !window.confirm("This permanently deletes their history. Are you sure?")
    )
      return;
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

  const [lifecycle, setLifecycle] = useState<Lifecycle>("active");
  const [origin, setOrigin] = useState<Origin>("all");
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
  // Origin narrows first: it's the dimension that crosses every lifecycle.
  const matchesOrigin = (s: SessionView) =>
    origin === "all" || (origin === "launched" ? !!s.launched : !s.launched);
  const inOrigin = sessions.filter(matchesOrigin);
  // Archived sessions are put away — they only show under the Archived tab,
  // never in active/idle/all.
  const live = inOrigin.filter((s) => !isArchived(s));

  // Lifecycle tab counts reflect the current origin selection, so the numbers
  // always match what the tab would show.
  const LIFECYCLES: { key: Lifecycle; label: string; count: number }[] = [
    { key: "active", label: "Active", count: live.filter(isActive).length },
    { key: "idle", label: "Idle", count: live.filter(isIdle).length },
    {
      key: "archived",
      label: "Archived",
      count: inOrigin.filter(isArchived).length,
    },
    { key: "all", label: "All", count: live.length },
  ];
  // Origin counts are over all non-archived sessions, independent of lifecycle.
  const notArchived = sessions.filter((s) => !isArchived(s));
  const ORIGINS: { key: Origin; label: string; count: number }[] = [
    { key: "all", label: "All", count: notArchived.length },
    {
      key: "watched",
      label: "Watched",
      count: notArchived.filter((s) => !s.launched).length,
    },
    {
      key: "launched",
      label: "Launched",
      count: notArchived.filter((s) => !!s.launched).length,
    },
  ];

  const shown =
    lifecycle === "active"
      ? live.filter(isActive)
      : lifecycle === "idle"
        ? live.filter(isIdle)
        : lifecycle === "archived"
          ? inOrigin.filter(isArchived)
          : live;
  const hasTerminated = sessions.some((s) => s.state === "terminated");

  return (
    <div className="rd-app">
      <header className="rd-topbar">
        <span className="rd-brand">
          <img
            className="rd-brand-mark"
            src="/favicon.svg"
            alt=""
            width={22}
            height={22}
          />
          RubberDuckHQ
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
            <div className="rd-filters">
              <div className="rd-segment">
                {LIFECYCLES.map((f) => (
                  <button
                    key={f.key}
                    className={lifecycle === f.key ? "active" : ""}
                    onClick={() => setLifecycle(f.key)}
                  >
                    {f.label} ({f.count})
                  </button>
                ))}
              </div>
              <label className="rd-origin">
                <span>Origin</span>
                <select
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value as Origin)}
                >
                  {ORIGINS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label} ({o.count})
                    </option>
                  ))}
                </select>
              </label>
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
          {hasTerminated && lifecycle === "all" && (
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
              launchedKeys={
                new Set(sessions.filter((s) => s.launched).map((s) => s.key))
              }
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
