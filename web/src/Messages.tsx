import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Read-only structured view of an agent's conversation (step 1 of the
// HTML-annotation / pagination foundation, docs/structured-render-design.md).
// Renders assistant text blocks as HTML and tool calls/results as chips, from
// GET /sessions/:key/messages. No annotation yet — that's the next step.

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

export function Messages({ sessionKey }: { sessionKey: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  if (loaded && messages.length === 0) {
    return (
      <div className="rd-panel-empty">
        No structured messages yet (claude-code sessions only).
      </div>
    );
  }

  return (
    <div className="rd-messages">
      {messages.map((m) => (
        <div key={m.id} className={`rd-msg rd-msg-${m.role}`}>
          {m.blocks.map((b, i) => {
            if (b.type === "text") {
              return (
                <div
                  key={i}
                  className="rd-msg-text"
                  dangerouslySetInnerHTML={{ __html: html(b.text) }}
                />
              );
            }
            if (b.type === "tool_use") {
              return (
                <div key={i} className="rd-msg-tool">
                  <span className="rd-msg-tool-name">{b.name}</span>
                </div>
              );
            }
            return null; // tool_result: hidden in the read-only view (context noise)
          })}
        </div>
      ))}
    </div>
  );
}
