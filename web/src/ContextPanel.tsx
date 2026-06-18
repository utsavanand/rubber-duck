import { useEffect, useState } from "react";
import { SessionView } from "./types";

// Right pane: context about the selected agent's terminal. If the session is on
// a git branch, show a git view (branch, repo, and the working-tree diff). If
// not, show the folder it's running in. (Approvals render above this in App.)
export function ContextPanel({ session }: { session: SessionView }) {
  const [diff, setDiff] = useState<string>("");
  const onBranch = !!session.branch;

  useEffect(() => {
    if (!onBranch) return;
    setDiff("");
    fetch(`/sessions/${session.key}/diff`)
      .then((r) => r.json())
      .then((d: { diff?: string; error?: string }) =>
        setDiff(d.error ? `git diff failed: ${d.error}` : (d.diff ?? "")),
      )
      .catch(() => setDiff(""));
  }, [session.key, onBranch]);

  return (
    <div className="rd-context">
      <div className="rd-context-meta">
        <div className="rd-context-row">
          <span className="k">state</span>
          <span className="v">{session.state}</span>
        </div>
        <div className="rd-context-row">
          <span className="k">agent</span>
          <span className="v">{session.runtime ?? "—"}</span>
        </div>
        {session.intention && (
          <div className="rd-context-row">
            <span className="k">intent</span>
            <span className="v">{session.intention}</span>
          </div>
        )}
      </div>

      {onBranch ? (
        <div className="rd-context-git">
          <div className="rd-context-section-title">Git</div>
          <div className="rd-context-row">
            <span className="k">branch</span>
            <span className="v mono">{session.branch}</span>
          </div>
          {session.repoName && (
            <div className="rd-context-row">
              <span className="k">repo</span>
              <span className="v mono">{session.repoName}</span>
            </div>
          )}
          <div className="rd-context-section-title">Working-tree diff</div>
          <pre className="rd-context-diff">
            {diff || "No uncommitted changes."}
          </pre>
        </div>
      ) : (
        <div className="rd-context-folder">
          <div className="rd-context-section-title">Folder</div>
          <code className="rd-context-path">{session.cwd ?? "—"}</code>
        </div>
      )}
    </div>
  );
}
