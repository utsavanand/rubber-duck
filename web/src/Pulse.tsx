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
            return (
              <div className="rd-pulse-row" key={e._id}>
                <span className="t">{time(e._ts)}</span>
                <div className="body">
                  <span className="who">{who}</span>
                  <span className="what">{describe(e)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
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
  const tool = e.tool_name ? ` ${e.tool_name}` : "";
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
      return "prompt submitted";
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
