import { useCallback, useEffect, useState } from "react";
import { api, authHeaders } from "./api";
import { SessionView } from "./types";
import { useToast } from "./ui";

interface Approval {
  id: string;
  session_key: string;
  tool_name: string;
  detail: string;
  created_at: number;
  reachable: boolean;
}

// Surfaces what needs you: pending permission requests (Approve/Deny without
// switching terminals) AND sessions that are simply waiting on an answer (the
// agent asked a question and paused — answer it in its terminal).
export function Approvals({
  labels,
  pollKey,
  onOpen,
  knownKeys,
  waiting,
  launchedKeys,
}: {
  labels: Record<string, string>;
  pollKey: number;
  onOpen: (key: string) => void;
  knownKeys: Set<string>;
  waiting: SessionView[];
  launchedKeys: Set<string>;
}) {
  const toast = useToast();

  // Jump straight to a launched session's terminal tab — the whole point of the
  // arrow here: when an agent needs you, one tap takes you to answer it.
  async function jump(key: string) {
    try {
      await api.focusTerminal(key);
    } catch (e) {
      toast(`Couldn't open terminal: ${(e as Error).message}`, "err");
    }
  }
  const [approvals, setApprovals] = useState<Approval[]>([]);

  const refresh = useCallback(() => {
    fetch("/approvals")
      .then((r) => r.json())
      .then((d: { approvals: Approval[] }) => setApprovals(d.approvals))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh, pollKey]);

  async function decide(id: string, decision: "approve" | "deny") {
    try {
      const res = await fetch(`/approvals/${id}/decide`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (res.ok && data.decided) {
        toast(decision === "approve" ? "Approved" : "Denied");
      } else {
        toast(
          "Couldn't reach the agent — only Rubberduck-launched sessions can be answered",
          "err",
        );
      }
      refresh();
    } catch {
      toast("Decision failed", "err");
    }
  }

  // Sessions that are waiting but aren't already covered by a pending approval
  // (the agent asked a question and paused, vs. a tool-permission prompt).
  const approvalKeys = new Set(approvals.map((a) => a.session_key));
  const asking = waiting.filter((s) => !approvalKeys.has(s.key));
  const total = approvals.length + asking.length;

  if (total === 0)
    return <p className="rd-panel-empty">Nothing needs you right now.</p>;

  return (
    <div className="rd-approvals">
      <h2>
        {total} session{total > 1 ? "s" : ""} waiting on you
      </h2>
      {approvals.map((a) => (
        <div className="rd-approval" key={a.id}>
          {(() => {
            const openable = knownKeys.has(a.session_key);
            return (
              <div
                style={{ flex: 1, cursor: openable ? "pointer" : "default" }}
                onClick={openable ? () => onOpen(a.session_key) : undefined}
                title={openable ? "Open session details" : undefined}
              >
                <div className="who">
                  {labels[a.session_key] ?? a.session_key.slice(0, 8)} ·{" "}
                  {a.tool_name}
                  {a.created_at > 0 && (
                    <span className="when">
                      {new Date(a.created_at).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {a.detail && (
                  <div className="what">
                    <code>{a.detail}</code>
                  </div>
                )}
              </div>
            );
          })()}
          {a.reachable ? (
            <>
              <button
                className="rd-btn rd-btn-sm rd-btn-ghost"
                onClick={() => decide(a.id, "deny")}
              >
                Deny
              </button>
              <button
                className="rd-btn rd-btn-sm rd-btn-primary"
                onClick={() => decide(a.id, "approve")}
              >
                Approve
              </button>
            </>
          ) : (
            // Watched session: Rubberduck doesn't own its terminal, so it can't
            // answer. Just say "watched"; the tooltip explains where to answer.
            <span
              className="rd-origin watched"
              title="Watched session — answer this in its own terminal; Rubberduck can only answer sessions it launched."
            >
              watched
            </span>
          )}
          {launchedKeys.has(a.session_key) && (
            <button
              className="rd-row-jump"
              title="Jump to this session's terminal tab"
              onClick={() => jump(a.session_key)}
            >
              ↗
            </button>
          )}
        </div>
      ))}
      {asking.map((s) => {
        const openable = knownKeys.has(s.key);
        return (
          <div className="rd-approval" key={s.key}>
            <div
              style={{ flex: 1, cursor: openable ? "pointer" : "default" }}
              onClick={openable ? () => onOpen(s.key) : undefined}
              title={openable ? "Open session details" : undefined}
            >
              <div className="who">
                {labels[s.key] ?? s.label} · waiting on your answer
              </div>
              <div className="what">
                Answer it in the session&apos;s terminal.
              </div>
            </div>
            <span
              className={`rd-origin ${s.launched ? "launched" : "watched"}`}
              title={
                s.launched
                  ? "Launched by Rubberduck — answer in its terminal tab"
                  : "Watched — answer in its own terminal"
              }
            >
              {s.launched ? "launched" : "watched"}
            </span>
            {s.launched && (
              <button
                className="rd-row-jump"
                title="Jump to this session's terminal tab"
                onClick={() => jump(s.key)}
              >
                ↗
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
