import { ReactNode, useEffect, useState } from "react";
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
  folders,
  onOpen,
  onFork,
  onDelete,
  onFoldersChanged,
}: {
  sessions: SessionView[];
  now: number;
  labels: Record<string, string>;
  folders: string[];
  onOpen: (key: string) => void;
  onFork: (key: string) => void;
  onDelete: (key: string) => Promise<boolean>;
  onFoldersChanged: () => void;
}) {
  const toast = useToast();
  const roots = buildForest(sessions);

  // Drop a session onto a folder header (or the ungrouped zone) to move it there.
  async function moveToGroup(key: string, group: string) {
    try {
      await api.setGroup(key, group);
      toast(group ? `Moved to ${group}` : "Removed from folder");
      onFoldersChanged();
    } catch (e) {
      toast(`Move failed: ${(e as Error).message}`, "err");
    }
  }

  async function removeFolder(name: string) {
    if (
      !window.confirm(
        `Delete folder "${name}"? Its sessions return to Ungrouped.`,
      )
    )
      return;
    try {
      await api.deleteFolder(name);
      toast(`Deleted folder ${name}`);
      onFoldersChanged();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "err");
    }
  }

  // Group root sessions by their folder label; forks stay nested under their root.
  const ungrouped: Node[] = [];
  const byFolder = new Map<string, Node[]>();
  for (const node of roots) {
    const g = node.session.group;
    if (g) (byFolder.get(g) ?? byFolder.set(g, []).get(g)!).push(node);
    else ungrouped.push(node);
  }

  const renderNode = (node: Node) => (
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
  );

  const hasFolders = folders.length > 0;
  if (sessions.length === 0 && !hasFolders) {
    return <p className="rd-panel-empty">No agents yet.</p>;
  }

  return (
    <div className="rd-tree">
      {/* All folders render (even empty ones) so you can create then fill them. */}
      {folders.map((name) => (
        <GroupHeader
          key={name}
          name={name}
          count={(byFolder.get(name) ?? []).length}
          onDropSession={moveToGroup}
          onDelete={() => removeFolder(name)}
        >
          {(byFolder.get(name) ?? []).map(renderNode)}
        </GroupHeader>
      ))}
      {/* Ungrouped sessions sit at the root; dropping here clears the folder. */}
      <DropZone group="" onDropSession={moveToGroup} active={hasFolders}>
        {ungrouped.map(renderNode)}
      </DropZone>
    </div>
  );
}

// A collapsible folder header that accepts dropped sessions.
function GroupHeader({
  name,
  count,
  onDropSession,
  onDelete,
  children,
}: {
  name: string;
  onDelete: () => void;
  count: number;
  onDropSession: (key: string, group: string) => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <div className={`rd-group${over ? " drop-over" : ""}`}>
      <div
        className="rd-group-head"
        onClick={() => setCollapsed((c) => !c)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/rd-session")) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const key = e.dataTransfer.getData("text/rd-session");
          if (key) onDropSession(key, name);
        }}
      >
        <span className="rd-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="rd-group-name">{name}</span>
        <span className="rd-group-count">{count}</span>
        <button
          className="rd-group-del"
          title="Delete folder (sessions return to Ungrouped)"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ✕
        </button>
      </div>
      {!collapsed && <div className="rd-group-body">{children}</div>}
    </div>
  );
}

// The catch-all zone for ungrouped sessions. Only a visible drop target when
// groups exist (otherwise it's just the plain list).
function DropZone({
  group,
  onDropSession,
  active,
  children,
}: {
  group: string;
  onDropSession: (key: string, group: string) => void;
  active: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`rd-dropzone${active ? " has-groups" : ""}${over ? " drop-over" : ""}`}
      onDragOver={(e) => {
        if (active && e.dataTransfer.types.includes("text/rd-session")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const key = e.dataTransfer.getData("text/rd-session");
        if (key) onDropSession(key, group);
      }}
    >
      {active && <div className="rd-dropzone-label">Ungrouped</div>}
      {children}
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
  const archived = effState === "archived";
  // "live" = actively running (Stop applies). stopped/terminated are not live but
  // are resumable for a launched session (we still have its worktree + id).
  const live = effState !== "terminated" && effState !== "stopped" && !archived;
  const resumable =
    (effState === "stopped" || effState === "terminated") && s.launched;
  // Stop and Archive only make sense for sessions Rubberduck owns. A watched
  // session runs in a terminal we don't control, so Stop can't end it and
  // Archive would only hide a row whose agent keeps running — and unarchiving it
  // would offer a Resume that can't fire. Keep watched sessions observe-only.
  const canStop = live && s.launched;
  const canArchive = !archived && s.launched;
  const stateLabel = effState === "waiting" ? "waiting on you" : effState;
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(s.notes ?? "");
  const [collapsed, setCollapsed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // Once stop/delete is in flight, grey the whole row's actions so a second
  // click can't fire a phantom request before the row is removed.
  const [ending, setEnding] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // Delete is destructive (wipes history) — require a second, deliberate click:
  // the button arms ("Confirm delete?") then deletes. Auto-disarms after 4s.
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  // Disarm the delete confirmation if the user doesn't follow through quickly.
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  async function requestDelete() {
    if (ending) return;
    if (!confirmDelete) {
      setConfirmDelete(true); // first click: arm
      return;
    }
    setConfirmDelete(false);
    setEnding(true);
    const deleted = await onDelete(s.key);
    if (!deleted) setEnding(false); // cancelled (e.g. unmerged confirm) or failed
  }

  async function archiveSession() {
    if (archiving) return;
    setArchiving(true);
    try {
      await api.archive(s.key);
      toast("Archived");
      // The archive event removes it from this view; no need to un-set.
    } catch (e) {
      toast(`Archive failed: ${(e as Error).message}`, "err");
      setArchiving(false);
    }
  }

  async function unarchiveSession() {
    if (archiving) return;
    setArchiving(true);
    try {
      await api.unarchive(s.key);
      toast("Unarchived");
    } catch (e) {
      toast(`Unarchive failed: ${(e as Error).message}`, "err");
      setArchiving(false);
    }
  }

  async function resumeSession() {
    if (resuming) return;
    setResuming(true);
    try {
      const r = await api.resume(s.key);
      toast(
        r.resumed ? "Resumed" : "Couldn't open a terminal to resume",
        r.resumed ? undefined : "err",
      );
    } catch (e) {
      toast(`Resume failed: ${(e as Error).message}`, "err");
    } finally {
      setResuming(false);
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
        // Only root sessions are draggable into groups; forks follow their parent.
        draggable={depth === 0}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/rd-session", s.key);
          e.dataTransfer.effectAllowed = "move";
        }}
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
          {/* An archived session is at rest: only bring-it-back and delete. */}
          {archived && (
            <button
              className="rd-btn rd-btn-sm rd-btn-primary"
              title="Bring this session back into view (as stopped — resume to continue)"
              disabled={archiving}
              onClick={unarchiveSession}
            >
              {archiving ? (
                <span className="rd-inline-spin">
                  <span className="rd-spinner" />
                  Unarchiving…
                </span>
              ) : (
                "Unarchive"
              )}
            </button>
          )}
          {/* One branching action: the modal offers a git worktree fork (or
              promotes an in-place session onto a branch) and, for claude-code,
              a conversation-only fork. */}
          {!archived && canBranch && (
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              title="Fork this session — into a git worktree, or fork the conversation"
              onClick={() => onFork(s.key)}
            >
              Fork
            </button>
          )}
          {!archived && (
            <button
              className={`rd-btn rd-btn-sm rd-btn-ghost${notesOpen ? " active" : ""}`}
              title="Personal notes for this session (local only)"
              onClick={() => setNotesOpen((o) => !o)}
            >
              Notes{s.notes ? " •" : ""}
            </button>
          )}
          {!archived && (
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
          )}
          {resumable && (
            <button
              className="rd-btn rd-btn-sm rd-btn-primary"
              title="Relaunch this session — continues the conversation for Claude Code"
              disabled={resuming}
              onClick={resumeSession}
            >
              {resuming ? (
                <span className="rd-inline-spin">
                  <span className="rd-spinner" />
                  Resuming…
                </span>
              ) : (
                "Resume"
              )}
            </button>
          )}
          {canStop && (
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
          {canArchive && (
            <button
              className="rd-btn rd-btn-sm rd-btn-ghost"
              title="Put this session away — keeps its history, hides it under Archived"
              disabled={archiving}
              onClick={archiveSession}
            >
              {archiving ? (
                <span className="rd-inline-spin">
                  <span className="rd-spinner" />
                  Archiving…
                </span>
              ) : (
                "Archive"
              )}
            </button>
          )}
          <button
            className={`rd-btn rd-btn-sm rd-btn-danger${confirmDelete ? " armed" : ""}`}
            title={
              confirmDelete
                ? "Click again to permanently delete this session and its history"
                : "Remove this session from history"
            }
            disabled={ending}
            onClick={requestDelete}
          >
            {confirmDelete ? "Confirm delete?" : "Delete"}
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
