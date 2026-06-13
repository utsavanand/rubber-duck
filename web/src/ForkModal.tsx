import { useEffect, useState } from "react";
import { api } from "./api";
import { SessionView } from "./types";
import { Button, Field, inputStyle, Modal, useToast } from "./ui";

// Forking a session creates a NEW git worktree on a NEW branch, taken off the
// parent's branch, and opens the forked agent in a terminal you can drive.
export function ForkModal({
  session,
  onClose,
}: {
  session: SessionView;
  onClose: () => void;
}) {
  const toast = useToast();
  const canConversationFork = session.runtime === "claude-code";
  const canWorktreeFork = Boolean(session.branch);
  // Default to whichever the session supports; worktree if both.
  const [mode, setMode] = useState<"worktree" | "conversation">(
    canWorktreeFork ? "worktree" : "conversation",
  );
  const [branch, setBranch] = useState(
    session.branch ? `${session.branch}-fork` : "",
  );
  const [command, setCommand] = useState("claude");
  const [terminals, setTerminals] = useState<string[]>([]);
  const [terminal, setTerminal] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .terminals()
      .then((d) => {
        setTerminals(d.terminals);
        setTerminal(d.terminals[0] ?? "");
      })
      .catch(() => undefined);
  }, []);

  async function submit() {
    setBusy(true);
    try {
      if (mode === "conversation") {
        const r = await api.forkConversation(
          session.key,
          terminal || undefined,
        );
        if (r.opened_in_terminal) {
          toast(`Opened forked conversation in ${terminal || "a terminal"}`);
        } else {
          toast(`Run it yourself: ${r.command}`, "err");
        }
      } else {
        const r = await api.fork(session.key, {
          command,
          branch: branch || undefined,
          terminal: terminal || undefined,
        });
        if (r.opened_in_terminal) {
          toast(`Opened fork on ${r.branch} in ${terminal || "a terminal"}`);
        } else {
          toast(
            `Worktree created; run in a terminal: cd ${r.worktree} && ${r.command}`,
            "err",
          );
        }
      }
      onClose();
    } catch (e) {
      toast(`Fork failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Fork ${session.label}`} onClose={onClose}>
      <Field label="What kind of fork?">
        <label
          className="rd-radio"
          style={{ opacity: canWorktreeFork ? 1 : 0.5 }}
        >
          <input
            type="radio"
            checked={mode === "worktree"}
            disabled={!canWorktreeFork}
            onChange={() => setMode("worktree")}
          />
          <span>
            <strong>Git worktree</strong> — branch off{" "}
            <code className="rd-inline-code">{session.branch ?? "—"}</code> into
            a new checkout so the fork's code is isolated
            {!canWorktreeFork && " (this session has no branch)"}
          </span>
        </label>
        <label
          className="rd-radio"
          style={{ opacity: canConversationFork ? 1 : 0.5 }}
        >
          <input
            type="radio"
            checked={mode === "conversation"}
            disabled={!canConversationFork}
            onChange={() => setMode("conversation")}
          />
          <span>
            <strong>Conversation only</strong> — resume the agent's conversation
            in a new terminal, no git branch
            {!canConversationFork && " (Claude Code sessions only)"}
          </span>
        </label>
      </Field>

      {mode === "worktree" && (
        <>
          <Field label="New branch">
            <input
              style={inputStyle}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feature/login-v2"
            />
          </Field>
          <Field label="Agent command">
            <input
              style={inputStyle}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </Field>
        </>
      )}
      {terminals.length > 0 && (
        <Field label="Open in">
          <select
            style={inputStyle}
            value={terminal}
            onChange={(e) => setTerminal(e.target.value)}
          >
            {terminals.map((t) => (
              <option key={t} value={t}>
                {t === "iterm" ? "iTerm" : t === "terminal" ? "Terminal" : t}
              </option>
            ))}
          </select>
        </Field>
      )}
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
