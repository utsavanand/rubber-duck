import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { authHeaders } from "./api";
import { useToast } from "./ui";

// Pagination mode (docs/structured-render-design.md): step through the agent's
// COMPLETED turns one at a time with ← →, with a feedback box per turn. Reuses
// the structured /messages records and the annotations send-back. Only completed
// turns are paginated; an in-flight response stays in the terminal.

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input?: unknown }
  | { type: "tool_result"; text: string };

interface Message {
  id: number;
  role: "user" | "assistant";
  blocks: Block[];
}

interface Turn {
  prompt: string | null;
  texts: string[];
  tools: string[];
}

function html(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

// Group the flat records into turns: a user prompt and the assistant reply that
// follows it (prose + the tools run in that turn).
function toTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const m of messages) {
    for (const b of m.blocks) {
      if (m.role === "user" && b.type === "text") {
        if (cur) turns.push(cur);
        cur = { prompt: b.text, texts: [], tools: [] };
      } else if (m.role === "assistant" && b.type === "text") {
        if (!cur) cur = { prompt: null, texts: [], tools: [] };
        cur.texts.push(b.text);
      } else if (b.type === "tool_use") {
        if (!cur) cur = { prompt: null, texts: [], tools: [] };
        cur.tools.push(b.name);
      }
    }
  }
  if (cur) turns.push(cur);
  // Only turns the agent actually replied to (a bare trailing prompt isn't a
  // completed turn).
  return turns.filter((t) => t.texts.length > 0);
}

export function Paginate({ sessionKey }: { sessionKey: string }) {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  // null = "track the latest turn"; a number = the user navigated to that index.
  const [pinned, setPinned] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/sessions/${sessionKey}/messages`)
        .then((r) => r.json())
        .then((d: { messages?: Message[] }) => {
          if (live) setMessages(d.messages ?? []);
        })
        .catch(() => undefined);
    load();
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [sessionKey]);

  const turns = useMemo(() => toTurns(messages), [messages]);
  // Default to the LATEST turn; once the user navigates, stay where they are.
  const last = Math.max(0, turns.length - 1);
  const idx = pinned === null ? last : Math.min(pinned, last);
  const turn = turns[idx];
  const go = (n: number) =>
    setPinned(Math.max(0, Math.min(turns.length - 1, n)));

  // Arrow keys step turns (when not typing in the feedback box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") go(idx - 1);
      if (e.key === "ArrowRight") go(idx + 1);
    };
    const el = ref.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [idx, turns.length]);

  async function sendFeedback() {
    if (!turn || !note.trim()) return;
    // Anchor the feedback to this turn's prompt (or its first line) so the agent
    // knows which section it's about. Reuses the annotations send-back.
    const quote = turn.prompt ?? turn.texts[0]?.slice(0, 80) ?? "";
    try {
      const res = await fetch(`/sessions/${sessionKey}/annotations`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ quote, note: note.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "failed");
      toast(d.sent ? "Sent to the agent" : "Saved (agent not live)");
      setNote("");
    } catch (e) {
      toast(`Feedback failed: ${(e as Error).message}`, "err");
    }
  }

  if (turns.length === 0) {
    return (
      <div className="rd-panel-empty">
        No completed turns yet (claude-code sessions only).
      </div>
    );
  }

  return (
    <div className="rd-paginate" tabIndex={0} ref={ref}>
      <div className="rd-paginate-nav">
        <button onClick={() => go(idx - 1)} disabled={idx === 0}>
          ←
        </button>
        <span className="rd-paginate-pos">
          {idx + 1} / {turns.length}
        </span>
        <button onClick={() => go(idx + 1)} disabled={idx === turns.length - 1}>
          →
        </button>
      </div>

      {turn.prompt && <div className="rd-msg-prompt">{turn.prompt}</div>}
      {turn.tools.length > 0 && (
        <div className="rd-msg-tools">used {countTools(turn.tools)}</div>
      )}
      {turn.texts.map((t, k) => (
        <div
          key={k}
          className="rd-msg-text"
          dangerouslySetInnerHTML={{ __html: html(t) }}
        />
      ))}

      <div className="rd-paginate-feedback">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="feedback on this section — sent back to the agent (⌘↵)"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendFeedback();
          }}
        />
        <button onClick={sendFeedback} disabled={!note.trim()}>
          Send ⌘↵
        </button>
      </div>
    </div>
  );
}

function countTools(tools: string[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
    .join(", ");
}
