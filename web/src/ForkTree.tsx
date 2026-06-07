import { useEffect, useState } from "react";

interface TreeNode {
  session_key: string;
  parent_session_key: string | null;
  state: string;
  started_at: number;
}

interface Rendered extends TreeNode {
  children: Rendered[];
}

function buildForest(nodes: TreeNode[]): Rendered[] {
  const byKey = new Map<string, Rendered>();
  for (const n of nodes) byKey.set(n.session_key, { ...n, children: [] });
  const roots: Rendered[] = [];
  for (const node of byKey.values()) {
    const parent = node.parent_session_key
      ? byKey.get(node.parent_session_key)
      : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const STATE_DOT: Record<string, string> = {
  busy: "#2563eb",
  idle: "#16a34a",
  waiting: "#d97706",
  terminated: "#6b7280",
};

function Node({
  node,
  depth,
  labels,
}: {
  node: Rendered;
  depth: number;
  labels: Record<string, string>;
}) {
  const label = labels[node.session_key] ?? node.session_key.slice(0, 12);
  return (
    <div>
      <div
        style={{
          paddingLeft: depth * 24,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 0",
        }}
      >
        <span style={{ color: "#9ca3af" }}>{depth > 0 ? "└─" : ""}</span>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: STATE_DOT[node.state] ?? "#6b7280",
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{node.state}</span>
      </div>
      {node.children
        .sort((a, b) => a.started_at - b.started_at)
        .map((c) => (
          <Node
            key={c.session_key}
            node={c}
            depth={depth + 1}
            labels={labels}
          />
        ))}
    </div>
  );
}

export function ForkTree({
  refreshKey,
  labels,
}: {
  refreshKey: number;
  labels: Record<string, string>;
}) {
  const [forest, setForest] = useState<Rendered[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/tree")
      .then((r) => r.json())
      .then((data: { nodes: TreeNode[] }) => {
        if (!cancelled) setForest(buildForest(data.nodes));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section className="rd-tree">
      <div className="rd-section-title">Fork tree</div>
      {forest.length === 0 ? (
        <p style={{ fontSize: 13, color: "#9ca3af" }}>No sessions yet.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 0 }}>
            Each top-level row is a session; forks nest underneath their parent.
          </p>
          {forest
            .sort((a, b) => a.started_at - b.started_at)
            .map((root) => (
              <Node
                key={root.session_key}
                node={root}
                depth={0}
                labels={labels}
              />
            ))}
        </>
      )}
    </section>
  );
}
