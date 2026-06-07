import { useState } from "react";
import { api, CompareVariant } from "./api";
import { Button, Field, inputStyle, Modal, useToast } from "./ui";

type Runtime = "generic" | "claude-code" | "codex";

export function CompareModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [repoPath, setRepoPath] = useState("");
  const [prompt, setPrompt] = useState("");
  const [variants, setVariants] = useState<CompareVariant[]>([
    { runtime: "claude-code", command: "claude" },
    { runtime: "codex", command: "codex" },
  ]);
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<CompareVariant>) {
    setVariants((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  async function submit() {
    if (!repoPath.trim() || !prompt.trim()) {
      toast("Repo path and prompt are required", "err");
      return;
    }
    setBusy(true);
    try {
      const { group } = await api.compare({
        repo_path: repoPath,
        prompt,
        variants,
      });
      toast(`Launched ${variants.length} variants in group ${group}`);
      onClose();
    } catch (e) {
      toast(`Compare failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Compare models" onClose={onClose}>
      <p style={{ marginTop: 0, fontSize: 13, color: "#6b7280" }}>
        Run one prompt as several agents on sibling branches, side by side.
      </p>
      <Field label="Repo path">
        <input
          style={inputStyle}
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="/Users/you/code/myrepo"
        />
      </Field>
      <Field label="Prompt (sent to every variant)">
        <input
          style={inputStyle}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="add a healthcheck endpoint"
        />
      </Field>
      <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
        Variants
      </div>
      {variants.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select
            style={{ ...inputStyle, width: 140 }}
            value={v.runtime}
            onChange={(e) => update(i, { runtime: e.target.value as Runtime })}
          >
            <option value="claude-code">claude-code</option>
            <option value="codex">codex</option>
            <option value="generic">generic</option>
          </select>
          <input
            style={inputStyle}
            value={v.command}
            onChange={(e) => update(i, { command: e.target.value })}
            placeholder="command"
          />
          {variants.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}
            >
              ✕
            </Button>
          )}
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          setVariants((v) => [...v, { runtime: "generic", command: "" }])
        }
      >
        + variant
      </Button>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? "Launching…" : `Launch ${variants.length}`}
        </Button>
      </div>
    </Modal>
  );
}
