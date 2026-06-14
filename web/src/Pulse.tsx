import { useState } from "react";
import { RubberduckEvent, sessionKeyOf } from "./types";

// A rolling feed of every agent's latest action, newest at the top. Reads the
// recentEvents buffer from useEventStream (no extra subscription).
export function Pulse({
  events,
  labels,
}: {
  events: RubberduckEvent[];
  labels: Record<string, string>;
}) {
  // Which row is expanded to show its full detail inline.
  const [openId, setOpenId] = useState<string | null>(null);
  // Static window: only the newest ~18, newest pinned at top. Older events drop
  // off the bottom rather than growing a scroll region.
  const shown = events.slice(0, 18);
  return (
    <aside className="rd-pulse">
      <div className="rd-panel-head">
        <span>Pulse</span>
        <span className="rd-pulse-live">
          <span className="rd-pulse-bars">
            <span />
            <span />
            <span />
          </span>
          live
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="rd-panel-empty">Waiting for activity…</p>
      ) : (
        <div className="rd-pulse-feed">
          {/* "more updates arrive above" affordance: three travelling dots that
              sit at the top of the static feed, where newer events land. */}
          <div className="rd-pulse-incoming" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          {shown.map((e) => {
            const key = sessionKeyOf(e);
            const who = (key && labels[key]) || e.name || e.source_app || "—";
            const expanded = openId === e._id;
            return (
              <div
                className={`rd-pulse-row clickable${expanded ? " expanded" : ""}`}
                key={e._id}
                onClick={() => setOpenId(expanded ? null : e._id)}
                title="Click for full detail"
              >
                <span className="t">{time(e._ts)}</span>
                <div className="body">
                  <span className="who">{who}</span>
                  <span className="what">{describe(e)}</span>
                  {expanded && <PulseDetail event={e} who={who} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

// The full detail for one pulse event, shown inline when its row is expanded:
// the complete command/prompt (untruncated) and the tool's full input.
function PulseDetail({ event, who }: { event: RubberduckEvent; who: string }) {
  const cmd = (event.tool_input?.command ??
    event.tool_input?.file_path ??
    event.tool_input?.path) as string | undefined;
  return (
    <div className="rd-pulse-detail" onClick={(e) => e.stopPropagation()}>
      <div className="row">
        <span className="k">session</span>
        <span className="v">{who}</span>
      </div>
      <div className="row">
        <span className="k">event</span>
        <span className="v">
          {event.event_type}
          {event.tool_name ? ` · ${event.tool_name}` : ""}
        </span>
      </div>
      {event.prompt && (
        <div className="row">
          <span className="k">prompt</span>
          <span className="v">{event.prompt}</span>
        </div>
      )}
      {cmd && (
        <div className="row">
          <span className="k">command</span>
          <code className="v">{cmd}</code>
        </div>
      )}
      {event.tool_input && !cmd && (
        <pre className="rd-pulse-json">
          {JSON.stringify(event.tool_input, null, 2)}
        </pre>
      )}
      <div className="row">
        <span className="k">time</span>
        <span className="v">{new Date(event._ts).toLocaleString()}</span>
      </div>
    </div>
  );
}

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function describe(e: RubberduckEvent): string {
  const detail = toolDetail(e);
  const tool = e.tool_name
    ? ` ${e.tool_name}${detail ? ` · ${detail}` : ""}`
    : "";
  switch (e.event_type) {
    case "PreToolUse":
      return `→${tool}`;
    case "PostToolUse":
      return `✓${tool}`;
    case "PermissionRequest":
      return "⚠ needs permission";
    case "Notification":
      return "⚠ notification";
    case "UserPromptSubmit":
      return e.prompt ? `prompt · ${truncate(e.prompt)}` : "prompt submitted";
    case "Stop":
      return "turn ended";
    case "SessionStart":
      return "session started";
    case "SessionEnd":
      return "session ended";
    default:
      return e.event_type ?? "event";
  }
}

// The command/argument for a tool call: the Bash command, else the file path
// (Edit/Write/Read), else a short repr of the first string field in tool_input.
function toolDetail(e: RubberduckEvent): string {
  const input = e.tool_input;
  if (!input) return "";
  const pick = input.command ?? input.file_path ?? input.path ?? input.pattern;
  if (typeof pick === "string") return truncate(pick);
  const firstString = Object.values(input).find((v) => typeof v === "string");
  return typeof firstString === "string" ? truncate(firstString) : "";
}

function truncate(s: string, max = 60): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}
