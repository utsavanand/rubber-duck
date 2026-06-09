import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "./api";
import { useToast } from "./ui";

interface Approval {
  id: string;
  session_key: string;
  tool_name: string;
  detail: string;
  reachable: boolean;
}

// Surfaces pending permission requests so you can answer an agent without
// switching to its terminal. Approve sends "1"; Deny sends Escape.
export function Approvals({
  labels,
  pollKey,
}: {
  labels: Record<string, string>;
  pollKey: number;
}) {
  const toast = useToast();
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

  if (approvals.length === 0)
    return <p className="rd-panel-empty">Nothing needs you right now.</p>;

  return (
    <div className="rd-approvals">
      <h2>
        {approvals.length} permission request{approvals.length > 1 ? "s" : ""}{" "}
        waiting on you
      </h2>
      {approvals.map((a) => (
        <div className="rd-approval" key={a.id}>
          <div style={{ flex: 1 }}>
            <div className="who">
              {labels[a.session_key] ?? a.session_key.slice(0, 8)} ·{" "}
              {a.tool_name}
            </div>
            {a.detail && (
              <div className="what">
                <code>{a.detail}</code>
              </div>
            )}
            {!a.reachable && (
              <div className="what" style={{ opacity: 0.8 }}>
                Answer in its own terminal — Rubberduck can only answer sessions
                it launched.
              </div>
            )}
          </div>
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
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              title="Stop showing this request"
              onClick={() =>
                setApprovals((list) => list.filter((x) => x.id !== a.id))
              }
            >
              Dismiss
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
