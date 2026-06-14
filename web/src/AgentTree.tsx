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
  onDelete: (key: string) => Promise<boolean>;
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
  onDelete: (key: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const s = node.session;
  const effState = effectiveState(s, now);
  const live = effState !== "terminated";
  const stateLabel = effState === "waiting" ? "waiting on you" : effState;
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(s.notes ?? "");
  const [collapsed, setCollapsed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // Once stop/delete is in flight, grey the whole row's actions so a second
  // click can't fire a phantom request before the row is removed.
  const [ending, setEnding] = useState(false);
  const hasChildren = node.children.length > 0;
  // Branching is possible for any live session on a git repo (worktree fork or
  // promote) and for any live claude-code session (conversation fork, even with
  // no branch). The ForkModal picks the right sub-option.
  const canBranch = live && (Boolean(s.branch) || s.runtime === "claude-code");

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
    setNotesOpen(false);
  }

  async function stopSession() {
    if (ending) return;
    setEnding(true);
    try {
      await api.stop(s.key);
      toast("Stopped");
      // Leave it greyed — the resulting Stop/terminated event removes the row.
    } catch (e) {
      toast(`Stop failed: ${(e as Error).message}`, "err");
      setEnding(false); // let the user retry
    }
  }

  async function captureCheckpoint() {
    if (capturing) return;
    // Capturing runs a summarizer agent (claude -p / codex / copilot), a few
    // seconds — show a spinner so the click doesn't feel dead.
    setCapturing(true);
    try {
      await act("Checkpoint recorded", () => api.checkpoint(s.key, "manual"));
    } finally {
      setCapturing(false);
    }
  }

  return (
    <>
      <div
        className={`rd-row${live ? "" : " terminated"}${notesOpen ? " expanded" : ""}`}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <div className="rd-row-main">
          {hasChildren ? (
            <button
              className="rd-row-collapse"
              title={collapsed ? "Show forks" : "Hide forks"}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => !c);
              }}
            >
              {collapsed ? "▸" : "▾"}
            </button>
          ) : (
            depth > 0 && <span className="rd-row-twig">⑂</span>
          )}
          <span className="rd-row-click" onClick={() => onOpen(s.key)}>
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
          </span>
          {s.launched && live && (
            <button
              className="rd-row-jump"
              title="Jump to this session's terminal tab"
              onClick={(e) => {
                e.stopPropagation();
                act("Opened terminal", () => api.focusTerminal(s.key));
              }}
            >
              ↗
            </button>
          )}
        </div>
        <div className="rd-row-meta" onClick={() => onOpen(s.key)}>
          {s.branch ? `${s.repoName ?? "repo"} · ${s.branch}` : (s.cwd ?? "—")}
          {" · "}
          {s.eventCount} ev
        </div>
        <div className="rd-row-actions">
          {/* One branching action: the modal offers a git worktree fork (or
              promotes an in-place session onto a branch) and, for claude-code,
              a conversation-only fork. */}
          {canBranch && (
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              title="Fork this session — into a git worktree, or fork the conversation"
              onClick={() => onFork(s.key)}
            >
              Fork
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
            disabled={capturing}
            onClick={captureCheckpoint}
          >
            {capturing ? (
              <span className="rd-inline-spin">
                <span className="rd-spinner" />
                Capturing…
              </span>
            ) : (
              "Checkpoint"
            )}
          </button>
          {live && (
            <button
              className="rd-btn rd-btn-sm rd-btn-danger"
              disabled={ending}
              onClick={stopSession}
            >
              {ending ? (
                <span className="rd-inline-spin">
                  <span className="rd-spinner" />
                  Stopping…
                </span>
              ) : (
                "Stop"
              )}
            </button>
          )}
          <button
            className="rd-btn rd-btn-sm rd-btn-danger"
            title="Remove this session from history"
            disabled={ending}
            onClick={async () => {
              setEnding(true);
              const deleted = await onDelete(s.key);
              if (!deleted) setEnding(false); // cancelled or failed — re-enable
            }}
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
      {!collapsed &&
        node.children.map((child) => (
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
