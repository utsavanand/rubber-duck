import { useState } from "react";
import { api } from "./api";
import { Button, Field, inputStyle, Modal, useToast } from "./ui";

export function LaunchModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [command, setCommand] = useState("claude");
  const [runtime, setRuntime] = useState<"generic" | "claude-code" | "codex">(
    "claude-code",
  );
  const [repoPath, setRepoPath] = useState("");
  const [branch, setBranch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!command.trim() || !repoPath.trim()) {
      toast("Command and repo path are required", "err");
      return;
    }
    setBusy(true);
    try {
      const { session_key } = await api.launch({
        command,
        runtime,
        repo_path: repoPath,
        branch: branch || undefined,
        prompt: prompt || undefined,
      });
      toast(`Launched ${session_key.slice(0, 8)} on a new worktree`);
      onClose();
    } catch (e) {
      toast(`Launch failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New session" onClose={onClose}>
      <Field label="Agent command">
        <input
          style={inputStyle}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder='e.g. claude -p "fix the parser"'
        />
      </Field>
      <Field label="Runtime">
        <select
          style={inputStyle}
          value={runtime}
          onChange={(e) => setRuntime(e.target.value as typeof runtime)}
        >
          <option value="claude-code">claude-code</option>
          <option value="codex">codex</option>
          <option value="generic">generic</option>
        </select>
      </Field>
      <Field label="Repo path (a git repo — the agent runs in an isolated worktree)">
        <input
          style={inputStyle}
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="/Users/you/code/myrepo"
        />
      </Field>
      <Field label="Branch (optional — defaults to a generated name)">
        <input
          style={inputStyle}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feature/login"
        />
      </Field>
      <Field label="Intention / prompt (optional — captured for the summary)">
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
