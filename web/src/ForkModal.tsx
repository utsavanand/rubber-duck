import { useState } from "react";
import { api } from "./api";
import { SessionView } from "./types";
import { Button, Field, inputStyle, Modal, useToast } from "./ui";

// Forking a session creates a NEW git worktree on a NEW branch, taken off the
// parent session's branch. This modal makes that explicit (the old inline Fork
// button silently branched with a generated name, which was confusing).
export function ForkModal({
  session,
  onClose,
}: {
  session: SessionView;
  onClose: () => void;
}) {
  const toast = useToast();
  const [branch, setBranch] = useState(
    session.branch ? `${session.branch}-fork` : "",
  );
  const [command, setCommand] = useState("claude");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const { session_key } = await api.fork(session.key, {
        command,
        branch: branch || undefined,
      });
      toast(
        `Forked into ${session_key.slice(0, 8)}${branch ? ` on ${branch}` : ""}`,
      );
      onClose();
    } catch (e) {
      toast(`Fork failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Fork ${session.label}`} onClose={onClose}>
      <p style={{ marginTop: 0, fontSize: 13, color: "#565869" }}>
        Creates a new git worktree on a new branch, taken off{" "}
        <code
          style={{ background: "#f3f3f5", padding: "1px 5px", borderRadius: 4 }}
        >
          {session.branch ?? "the session"}
        </code>
        . The two work independently.
      </p>
      <Field label="New branch">
        <input
          style={inputStyle}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feature/login-v2"
        />
      </Field>
      <Field label="Agent command for the fork">
        <input
          style={inputStyle}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
      </Field>
      <Field label="Prompt (optional)">
        <input
          style={inputStyle}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="try a different approach"
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
          {busy ? "Forking…" : "Create fork"}
        </Button>
      </div>
    </Modal>
  );
}
