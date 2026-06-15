import { useEffect, useState } from "react";
import { api } from "./api";
import { Button, Modal, useToast } from "./ui";

interface Snap {
  id: string;
  created_at: number;
}

export function SnapshotsModal({
  sessionKeys,
  onClose,
}: {
  sessionKeys: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [selected, setSelected] = useState<string>("");

  const refresh = () =>
    api
      .snapshots()
      .then((d) => setSnaps(d.snapshots))
      .catch(() => undefined);
  useEffect(() => {
    refresh();
  }, []);

  async function takeSnapshot() {
    try {
      const { id } = await api.snapshot();
      toast(`Snapshot ${id} created`);
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function restore(key: string) {
    if (!selected) {
      toast("Pick a snapshot first", "err");
      return;
    }
    try {
      const { command } = await api.restore(selected, key);
      toast(`Restoring: ${command}`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <Modal title="Snapshots" onClose={onClose}>
      <p style={{ marginTop: 0, fontSize: 13, color: "#6b7280" }}>
        Bundle all recently-active sessions to disk, or restore one in a new
        terminal.
      </p>
      <Button onClick={takeSnapshot}>Snapshot all active sessions</Button>

      <div style={{ marginTop: 20, fontSize: 13, color: "#374151" }}>
        Saved snapshots
      </div>
      {snaps.length === 0 ? (
        <p style={{ color: "#9ca3af", fontSize: 13 }}>None yet.</p>
      ) : (
        <select
          style={{
            width: "100%",
            padding: 8,
            marginTop: 6,
            borderRadius: 6,
            border: "1px solid #d1d5db",
          }}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">— choose a snapshot to restore from —</option>
          {snaps.map((s) => (
            <option key={s.id} value={s.id}>
              {new Date(s.created_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </option>
          ))}
        </select>
      )}

      {selected && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
            Restore a session
          </div>
          {sessionKeys.map((k) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
              }}
            >
              <code style={{ fontSize: 13 }}>{k.slice(0, 14)}</code>
              <Button size="sm" variant="ghost" onClick={() => restore(k)}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
