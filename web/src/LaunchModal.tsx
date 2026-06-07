import { useEffect, useState } from "react";
import { api, BrowseResult } from "./api";
import { Button, Field, inputStyle, Modal, useToast } from "./ui";

// New session: a command (runtime is inferred from it), a path picked by
// browsing the filesystem (git-detected), an optional name + prompt.
export function LaunchModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [command, setCommand] = useState("claude");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [picked, setPicked] = useState<BrowseResult | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);

  const path = picked?.path;
  const isGit = picked?.is_git ?? false;

  async function submit() {
    if (!command.trim() || !path) {
      toast("A command and a folder are required", "err");
      return;
    }
    setBusy(true);
    try {
      // A git folder gets an isolated worktree (repo_path); a plain folder runs
      // in place (cwd).
      const { session_key } = await api.launch({
        command,
        name: name || undefined,
        prompt: prompt || undefined,
        ...(isGit ? { repo_path: path } : { cwd: path }),
      });
      toast(`Launched ${name || session_key.slice(0, 8)}`);
      onClose();
    } catch (e) {
      toast(`Launch failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New session" onClose={onClose}>
      <Field label="Command (the agent to run — runtime is detected automatically)">
        <input
          style={inputStyle}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder='claude   ·   codex   ·   claude -p "fix the bug"'
        />
      </Field>

      <Field label="Folder to work in">
        {path ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <span className="mono" style={{ flex: 1, wordBreak: "break-all" }}>
              {path}
            </span>
            <span
              style={{
                color: isGit ? "var(--idle)" : "var(--muted)",
                whiteSpace: "nowrap",
              }}
            >
              {isGit ? "git repo" : "plain folder"}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setBrowsing(true)}>
              Change
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setBrowsing(true)}>
            Browse…
          </Button>
        )}
      </Field>

      {browsing && (
        <DirBrowser
          start={path}
          onPick={(r) => {
            setPicked(r);
            setBrowsing(false);
          }}
          onCancel={() => setBrowsing(false)}
        />
      )}

      <Field label="Name (optional)">
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. login refactor"
        />
      </Field>
      <Field label="Prompt / what you want it to do (optional)">
        <input
          style={inputStyle}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="add a healthcheck endpoint"
        />
      </Field>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 8,
        }}
      >
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? "Launching…" : "Launch"}
        </Button>
      </div>
    </Modal>
  );
}

// A simple server-backed folder navigator: lists subdirectories, flags git
// repos, lets you go up / into / select the current folder.
function DirBrowser({
  start,
  onPick,
  onCancel,
}: {
  start?: string;
  onPick: (r: BrowseResult) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<BrowseResult | null>(null);

  function load(path?: string) {
    api
      .browse(path)
      .then(setData)
      .catch(() => undefined);
  }
  useEffect(() => {
    load(start);
  }, [start]);

  if (!data)
    return <p style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</p>;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        marginBottom: 12,
        background: "var(--bg-soft)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          className="rd-btn rd-btn-sm rd-btn-ghost"
          disabled={!data.parent}
          onClick={() => data.parent && load(data.parent)}
        >
          ↑ Up
        </button>
        <span
          className="mono"
          style={{ flex: 1, fontSize: 12, wordBreak: "break-all" }}
        >
          {data.path}
        </span>
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto", padding: 6 }}>
        {data.entries.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: 8 }}>
            No subfolders.
          </div>
        )}
        {data.entries.map((e) => (
          <div
            key={e.path}
            onClick={() => load(e.path)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 8px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <span>📁</span>
            <span style={{ flex: 1 }}>{e.name}</span>
            {e.is_git && (
              <span style={{ fontSize: 11, color: "var(--idle)" }}>git</span>
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onPick(data)}>
          Use this folder{data.is_git ? " (git)" : ""}
        </Button>
      </div>
    </div>
  );
}
