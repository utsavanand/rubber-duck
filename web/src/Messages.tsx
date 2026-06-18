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
    <div className="rd-messages">
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
