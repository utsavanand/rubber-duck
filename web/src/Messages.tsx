import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { authHeaders } from "./api";
import { useToast } from "./ui";

// Structured view of an agent's latest reply (HTML-annotation mode,
// docs/structured-render-design.md). Renders the response as HTML; select any
// span to attach a note, which is stored AND sent back to the agent as a
// follow-up prompt.

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input?: unknown }
  | { type: "tool_result"; text: string };

interface Message {
  id: number;
  role: "user" | "assistant";
  blocks: Block[];
}

function html(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

interface Selection {
  quote: string;
  x: number;
  y: number;
}

export function Messages({ sessionKey }: { sessionKey: string }) {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [note, setNote] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Capture a text selection inside the messages and anchor a note popover to it.
  const onMouseUp = () => {
    const s = window.getSelection();
    const text = s?.toString().trim();
    if (!text || !s || s.rangeCount === 0) {
      if (!note) setSel(null);
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const wrap = wrapRef.current?.getBoundingClientRect();
    setSel({
      quote: text,
      x: rect.left - (wrap?.left ?? 0),
      y: rect.bottom - (wrap?.top ?? 0) + (wrapRef.current?.scrollTop ?? 0),
    });
  };

  async function submitAnnotation() {
    if (!sel || !note.trim()) return;
    try {
      const res = await fetch(`/sessions/${sessionKey}/annotations`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ quote: sel.quote, note: note.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "failed");
      toast(d.sent ? "Sent to the agent" : "Saved (agent not live)");
    } catch (e) {
      toast(`Annotation failed: ${(e as Error).message}`, "err");
    } finally {
      setSel(null);
      setNote("");
      window.getSelection()?.removeAllRanges();
    }
  }

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/sessions/${sessionKey}/messages`)
        .then((r) => r.json())
        .then((d: { messages?: Message[] }) => {
          if (live) {
            setMessages(d.messages ?? []);
            setLoaded(true);
          }
        })
        .catch(() => undefined);
    load();
    // The transcript grows as the agent works; refresh on a light interval.
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [sessionKey]);

  // The LATEST agent reply: the prose since the last user prompt, rendered as
  // clean HTML — a readable version of what the CLI just output. We don't dump
  // the whole history; this is "the new message", made readable. Tools the agent
  // ran in this turn collapse into one compact line.
  const latest = latestReply(messages);

  if (loaded && !latest) {
    return (
      <div className="rd-panel-empty">
        No agent reply yet (claude-code sessions only).
      </div>
    );
  }
  if (!latest) return <div className="rd-messages" />;

  return (
    <div className="rd-messages" ref={wrapRef} onMouseUp={onMouseUp}>
      {latest.prompt && <div className="rd-msg-prompt">{latest.prompt}</div>}
      {latest.tools.length > 0 && (
        <div className="rd-msg-tools">{summarizeTools(latest.tools)}</div>
      )}
      {latest.texts.map((t, i) => (
        <div
          key={i}
          className="rd-msg-text"
          dangerouslySetInnerHTML={{ __html: html(t) }}
        />
      ))}
      {sel && (
        <div
          className="rd-annotate-pop"
          style={{ left: sel.x, top: sel.y + 6 }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="rd-annotate-quote">“{sel.quote.slice(0, 80)}”</div>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note to send back to the agent…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                submitAnnotation();
              if (e.key === "Escape") {
                setSel(null);
                setNote("");
              }
            }}
          />
          <div className="rd-annotate-actions">
            <button onClick={submitAnnotation} disabled={!note.trim()}>
              Send ⌘↵
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Reply {
  prompt: string | null; // the user prompt that started this turn
  texts: string[]; // assistant prose blocks in the turn
  tools: string[]; // tool names the agent ran in the turn
}

// Walk back from the end to the most recent user prompt; everything after it is
// the agent's latest reply.
function latestReply(messages: Message[]): Reply | null {
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (
      messages[i].role === "user" &&
      messages[i].blocks.some((b) => b.type === "text")
    ) {
      start = i;
      break;
    }
  }
  const turn = start >= 0 ? messages.slice(start) : messages;
  const reply: Reply = { prompt: null, texts: [], tools: [] };
  turn.forEach((m, idx) => {
    for (const b of m.blocks) {
      if (b.type === "text") {
        if (m.role === "user" && idx === 0) reply.prompt = b.text;
        else if (m.role === "assistant") reply.texts.push(b.text);
      } else if (b.type === "tool_use") {
        reply.tools.push(b.name);
      }
    }
  });
  return reply.texts.length || reply.prompt ? reply : null;
}

// "used Read ×8, Bash" — counts per tool, most-used first.
function summarizeTools(tools: string[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  return `used ${parts.join(", ")}`;
}
