import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

// Live agent output (PTY) for a session, with a stdin input line for
// terminal-attach. Streams from GET /sessions/:key/output (SSE) and writes via
// POST /sessions/:key/input.
export function LiveOutput({ sessionKey }: { sessionKey: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [attached, setAttached] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([]);
    const source = new EventSource(`/sessions/${sessionKey}/output`);
    source.onopen = () => setAttached(true);
    source.onerror = () => setAttached(false);
    source.onmessage = (msg) => {
      const { line } = JSON.parse(msg.data) as { line: string };
      setLines((prev) => [...prev.slice(-1999), line]);
    };
    return () => source.close();
  }, [sessionKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [lines]);

  async function send() {
    if (!input) return;
    const text = input + "\n";
    setInput("");
    try {
      const res = await fetch(`/sessions/${sessionKey}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setLines((p) => [
          ...p,
          "[rubberduck] could not send input — session not live",
        ]);
      }
    } catch {
      setLines((p) => [...p, "[rubberduck] input failed"]);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          fontSize: 12,
          color: attached ? "#16a34a" : "#9ca3af",
          marginBottom: 6,
        }}
      >
        {attached
          ? "● attached to live output"
          : "○ runs in your own terminal — type there, not here"}
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 240,
          background: "#0c0f16",
          color: "#d1d5db",
          borderRadius: 8,
          padding: 12,
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {lines.length === 0 ? (
          <span style={{ color: "#6b7280" }}>No output yet.</span>
        ) : (
          lines.map((l, i) => <div key={i}>{l}</div>)
        )}
      </div>
      {/* Input only works when Rubberduck owns the PTY (a session it launched).
          Watched sessions stream output but have no stdin we can write to, so
          hide the box rather than offer an action that always fails. */}
      {attached && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="type to the agent and press Enter…"
            style={{
              flex: 1,
              padding: "8px 10px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "ui-monospace, Menlo, monospace",
            }}
          />
          <Button size="sm" onClick={send}>
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
