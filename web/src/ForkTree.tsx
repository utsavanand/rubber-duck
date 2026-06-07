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

function Node({ node, depth }: { node: Rendered; depth: number }) {
  return (
    <div>
      <div
        style={{
          paddingLeft: depth * 24,
          display: "flex",
          alignItems: "center",
          gap: 8,
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
        <code style={{ fontSize: 13 }}>{node.session_key.slice(0, 12)}</code>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{node.state}</span>
      </div>
      {node.children
        .sort((a, b) => a.started_at - b.started_at)
        .map((c) => (
          <Node key={c.session_key} node={c} depth={depth + 1} />
        ))}
    </div>
  );
}

export function ForkTree({ refreshKey }: { refreshKey: number }) {
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

  if (forest.length === 0) return null;

  const hasForks = forest.some((r) => r.children.length > 0);
  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 16 }}>Fork tree</h2>
      {!hasForks && (
        <p style={{ color: "#9ca3af", fontSize: 13 }}>
          No forks yet — fork a session to branch it.
        </p>
      )}
      {forest
        .sort((a, b) => a.started_at - b.started_at)
        .map((root) => (
          <Node key={root.session_key} node={root} depth={0} />
        ))}
    </section>
  );
}
