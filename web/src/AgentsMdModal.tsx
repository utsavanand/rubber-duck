import { useEffect, useState } from "react";
import { authHeaders } from "./api";
import { Button, Modal, useToast } from "./ui";

// View and edit the AGENTS.md for one folder — the shared, cross-agent
// instructions for work in that directory (read by Claude, Codex, etc. alike).
// One file per folder; this is how the same guidance applies across every agent
// run there.
export function AgentsMdModal({
  dir,
  onClose,
}: {
  dir: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/agents-md?dir=${encodeURIComponent(dir)}`)
      .then((r) => r.json())
      .then((d: { text?: string }) => setText(d.text ?? ""))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [dir]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/agents-md", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ dir, text }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "save failed");
      toast("AGENTS.md saved");
      onClose();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="AGENTS.md" onClose={onClose}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        <code>{dir}/AGENTS.md</code>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          loading
            ? "Loading…"
            : "# AGENTS.md\n\nShared instructions for every agent working in this folder…"
        }
        spellCheck={false}
        style={{
          width: "100%",
          height: 360,
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 13,
          lineHeight: 1.5,
          padding: 12,
          border: "1px solid var(--border)",
          borderRadius: 8,
          resize: "vertical",
          background: "var(--card)",
          color: "var(--text)",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 12,
        }}
      >
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
