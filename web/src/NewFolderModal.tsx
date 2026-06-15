import { useState } from "react";
import { api } from "./api";
import { Button, Field, inputStyle, Modal, useToast } from "./ui";

// Create a folder for the left panel. Folders persist on the server even while
// empty, so you can make one and then drag sessions into it.
export function NewFolderModal({
  existing,
  onClose,
  onCreated,
}: {
  existing: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing.includes(trimmed)) {
      toast(`Folder "${trimmed}" already exists`, "err");
      return;
    }
    setBusy(true);
    try {
      await api.createFolder(trimmed);
      toast(`Created folder ${trimmed}`);
      onCreated();
    } catch (e) {
      toast(`Create failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New folder" onClose={onClose}>
      <Field label="Folder name">
        <input
          autoFocus
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="e.g. payments"
        />
      </Field>
      <p className="rd-modal-hint">
        Then drag sessions onto this folder in the left panel to organize them.
      </p>
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
        <Button onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create folder"}
        </Button>
      </div>
    </Modal>
  );
}
