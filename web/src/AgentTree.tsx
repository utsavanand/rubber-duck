import { useState } from "react";
import { api } from "./api";
import { effectiveState } from "./sessions";
import { SessionView } from "./types";
import { useToast } from "./ui";

// The left panel: every session as a row, with forks nested under their parent
// via parentKey. Clicking a row opens the detail drawer; actions sit inline.
export function AgentTree({
  sessions,
  now,
  labels,
  onOpen,
  onFork,
  onDelete,
}: {
  sessions: SessionView[];
  now: number;
  labels: Record<string, string>;
  onOpen: (key: string) => void;
  onFork: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const roots = buildForest(sessions);
  if (sessions.length === 0) {
    return <p className="rd-panel-empty">No agents yet.</p>;
  }
  return (
    <div className="rd-tree">
      {roots.map((node) => (
        <TreeRow
          key={node.session.key}
          node={node}
          depth={0}
          now={now}
          labels={labels}
          onOpen={onOpen}
          onFork={onFork}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

interface Node {
  session: SessionView;
  children: Node[];
}

// Nest sessions by parentKey. A session whose parent isn't in the visible set
// (e.g. filtered out) becomes its own root so it's never hidden.
function buildForest(sessions: SessionView[]): Node[] {
  const byKey = new Map(sessions.map((s) => [s.key, s]));
  const nodes = new Map<string, Node>(
    sessions.map((s) => [s.key, { session: s, children: [] }]),
  );
  const roots: Node[] = [];
  for (const s of sessions) {
    const node = nodes.get(s.key)!;
    if (s.parentKey && byKey.has(s.parentKey)) {
      nodes.get(s.parentKey)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function TreeRow({
  node,
  depth,
  now,
  labels,
  onOpen,
  onFork,
  onDelete,
}: {
  node: Node;
  depth: number;
  now: number;
  labels: Record<string, string>;
  onOpen: (key: string) => void;
  onFork: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const toast = useToast();
  const s = node.session;
  const effState = effectiveState(s, now);
  const live = effState !== "terminated";
  const stateLabel = effState === "waiting" ? "waiting on you" : effState;
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(s.notes ?? "");

  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast(label);
    } catch (e) {
      toast(`${label} failed: ${(e as Error).message}`, "err");
    }
  }

  async function saveNotes() {
    if (notes === (s.notes ?? "")) return;
    await act("Notes saved", () => api.updateSession(s.key, { notes }));
  }

  return (
    <>
      <div
        className={`rd-row${live ? "" : " terminated"}${notesOpen ? " expanded" : ""}`}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <div className="rd-row-main" onClick={() => onOpen(s.key)}>
          {depth > 0 && <span className="rd-row-twig">⑂</span>}
          {s.branch && (
            <span
              className="rd-row-git"
              title={
                s.worktreePath
                  ? `Working in a git worktree on ${s.branch}`
                  : `On git branch ${s.branch}`
              }
            >
              ⎇
            </span>
          )}
          <span className="rd-row-name">{s.label}</span>
          <span
            className={`rd-origin ${s.launched ? "launched" : "watched"}`}
            title={
              s.launched
                ? "Launched by Rubberduck — it owns this tab, so you can type to it and answer prompts here"
                : "Watched — you started this agent yourself; Rubberduck observes it but can't drive it"
            }
          >
            {s.launched ? "launched" : "watched"}
          </span>
          <span className={`rd-state st-${effState}`}>
            <span className="dot" />
            {stateLabel}
          </span>
        </div>
        <div className="rd-row-meta" onClick={() => onOpen(s.key)}>
          {s.branch ? `${s.repoName ?? "repo"} · ${s.branch}` : (s.cwd ?? "—")}
          {" · "}
          {s.eventCount} ev
        </div>
        <div className="rd-row-actions">
          {s.branch && live && (
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              title="Branch the code: new worktree + branch off this one"
              onClick={() => onFork(s.key)}
            >
              Fork
            </button>
          )}
          {/* An in-place session (no worktree yet) can be promoted onto a branch
              when the user decides the work is worth publishing. */}
          {!s.worktreePath && s.cwd && live && (
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              title="Create a git worktree + branch for this session so you can publish its work"
              onClick={() =>
                act("Worktree created", () => api.promote(s.key, {}))
              }
            >
              Create worktree
            </button>
          )}
          <button
            className={`rd-btn rd-btn-sm rd-btn-ghost${notesOpen ? " active" : ""}`}
            title="Personal notes for this session (local only)"
            onClick={() => setNotesOpen((o) => !o)}
          >
            Notes{s.notes ? " •" : ""}
          </button>
          <button
            className="rd-btn rd-btn-sm rd-btn-ghost"
            title="Record what was done so far"
            onClick={() =>
              act("Checkpoint recorded", () => api.checkpoint(s.key, "manual"))
            }
          >
            Checkpoint
          </button>
          {live && (
            <button
              className="rd-btn rd-btn-sm rd-btn-danger"
              onClick={() => act("Stopped", () => api.stop(s.key))}
            >
              Stop
            </button>
          )}
          <button
            className="rd-btn rd-btn-sm rd-btn-danger"
            title="Remove this session from history"
            onClick={() => onDelete(s.key)}
          >
            Delete
          </button>
        </div>
        {notesOpen && (
          <div className="rd-row-notes-wrap">
            <textarea
              className="rd-row-notes"
              value={notes}
              placeholder="Notes for this session (local only)…"
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
            <div className="rd-row-notes-bar">
              <span className="hint">
                {notes !== (s.notes ?? "") ? "Unsaved changes" : "Saved"}
              </span>
              <button
                className="rd-btn rd-btn-sm rd-btn-primary"
                disabled={notes === (s.notes ?? "")}
                onClick={saveNotes}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
      {node.children.map((child) => (
        <TreeRow
          key={child.session.key}
          node={child}
          depth={depth + 1}
          now={now}
          labels={labels}
          onOpen={onOpen}
          onFork={onFork}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}
