import { useEffect, useState } from "react";
import { api } from "./api";
import { Button, Modal, useToast } from "./ui";

interface Snap {
  id: string;
  created_at: number;
}

interface SnapSession {
  session_key: string;
  name?: string | null;
  runtime?: string | null;
}

export function SnapshotsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [selected, setSelected] = useState<string>("");
  // The sessions captured in the selected snapshot — these (not the live
  // dashboard's sessions) are what can be restored from it.
  const [sessions, setSessions] = useState<SnapSession[]>([]);

  const refresh = () =>
    api
      .snapshots()
      .then((d) => setSnaps(d.snapshots))
      .catch(() => undefined);
  useEffect(() => {
    refresh();
  }, []);

  // When a snapshot is picked, load the sessions it actually contains.
  useEffect(() => {
    if (!selected) {
      setSessions([]);
      return;
    }
    api
      .snapshotSessions(selected)
      .then((d) => setSessions(d.sessions))
      .catch(() => setSessions([]));
  }, [selected]);

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
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </option>
          ))}
        </select>
      )}

      {selected && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
            Sessions in this snapshot
          </div>
          {sessions.length === 0 ? (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>
              No sessions captured in this snapshot.
            </p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.session_key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 0",
                }}
              >
                <code style={{ fontSize: 13 }}>
                  {s.name || s.session_key.slice(0, 14)}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => restore(s.session_key)}
                >
                  Restore
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
