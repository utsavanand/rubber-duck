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
      onClose();
    } catch (e) {
      toast(`Fork failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Fork ${session.label}`} onClose={onClose}>
      <p style={{ marginTop: 0, fontSize: 13, color: "var(--text-soft)" }}>
        Creates a new git worktree on a new branch off{" "}
        <code
          style={{
            background: "var(--bg-soft)",
            padding: "1px 5px",
            borderRadius: 4,
          }}
        >
          {session.branch ?? "the session"}
        </code>{" "}
        and opens the agent in a terminal you can drive.
      </p>
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
