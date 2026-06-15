import { describe, expect, it } from "vitest";
import {
  applyAll,
  applyEvent,
  effectiveState,
  IDLE_SETTLE_MS,
} from "./sessions";
import { RubberduckEvent, SessionView } from "./types";

function ev(
  e: Partial<RubberduckEvent> & { event_type: string },
): RubberduckEvent {
  return { session_key: "s1", _id: "e", _ts: 1000, ...e } as RubberduckEvent;
}

const empty = () => new Map<string, SessionView>();

describe("applyEvent", () => {
  it("creates a session from its first event, deriving the label from source_app", () => {
    const after = applyEvent(
      empty(),
      ev({ event_type: "SessionStart", source_app: "myrepo" }),
    );

    const s = after.get("s1")!;
    expect(s.label).toBe("myrepo");
    expect(s.state).toBe("busy");
    expect(s.eventCount).toBe(1);
  });

  it("keeps a session launched once seen launched, even if a later event omits it", () => {
    const launched = applyEvent(
      empty(),
      ev({ event_type: "SessionStart", launched: true }),
    );

    const after = applyEvent(
      launched,
      ev({ event_type: "PreToolUse", tool_name: "Bash" }),
    );

    expect(after.get("s1")!.launched).toBe(true);
  });

  it("does not rename the session from source_app on later events", () => {
    const first = applyEvent(
      empty(),
      ev({ event_type: "SessionStart", source_app: "myrepo" }),
    );

    // An agent cd-ing into web/ would otherwise rename the session to "web".
    const after = applyEvent(
      first,
      ev({ event_type: "PreToolUse", source_app: "web" }),
    );

    expect(after.get("s1")!.label).toBe("myrepo");
  });

  it("stamps idleSince on Stop and clears it on the next activity", () => {
    const stopped = applyEvent(empty(), ev({ event_type: "Stop", _ts: 5000 }));
    expect(stopped.get("s1")!.idleSince).toBe(5000);

    const active = applyEvent(
      stopped,
      ev({ event_type: "PreToolUse", _ts: 6000 }),
    );
    expect(active.get("s1")!.idleSince).toBeUndefined();
  });

  it("keeps a stopped session at rest until an explicit SessionStart", () => {
    const stopped = applyEvent(
      empty(),
      ev({ event_type: "Notification", lifecycle: "stopped" }),
    );
    expect(stopped.get("s1")!.state).toBe("stopped");

    // A stray late event (e.g. a SessionEnd) must not flip it to terminated.
    const stray = applyEvent(stopped, ev({ event_type: "SessionEnd" }));
    expect(stray.get("s1")!.state).toBe("stopped");

    // Only a SessionStart revives it.
    const revived = applyEvent(stopped, ev({ event_type: "SessionStart" }));
    expect(revived.get("s1")!.state).toBe("busy");
  });

  it("maps permission requests to waiting and SessionEnd to terminated", () => {
    expect(
      applyEvent(empty(), ev({ event_type: "PermissionRequest" })).get("s1")!
        .state,
    ).toBe("waiting");
    expect(
      applyEvent(empty(), ev({ event_type: "SessionEnd" })).get("s1")!.state,
    ).toBe("terminated");
  });

  it("ignores an event with no session key", () => {
    const before = empty();
    const after = applyEvent(before, {
      event_type: "Stop",
      _id: "x",
      _ts: 1,
    } as RubberduckEvent);
    expect(after).toBe(before);
  });
});

describe("effectiveState", () => {
  const base: SessionView = {
    key: "s1",
    label: "s1",
    state: "busy",
    lastEventType: "",
    startedAt: 0,
    updatedAt: 0,
    eventCount: 1,
  };

  it("settles a stopped-but-busy session to idle only after the grace window", () => {
    const s = { ...base, state: "busy" as const, idleSince: 1000 };

    expect(effectiveState(s, 1000 + IDLE_SETTLE_MS - 1)).toBe("busy");
    expect(effectiveState(s, 1000 + IDLE_SETTLE_MS)).toBe("idle");
  });

  it("returns terminal/at-rest states immediately without the grace", () => {
    for (const state of [
      "terminated",
      "stopped",
      "archived",
      "waiting",
    ] as const) {
      expect(effectiveState({ ...base, state }, 1e15)).toBe(state);
    }
  });
});

describe("applyAll", () => {
  it("folds a sequence of events into the final session state", () => {
    const map = applyAll([
      ev({ event_type: "SessionStart", launched: true }),
      ev({ event_type: "PreToolUse" }),
      ev({ event_type: "Stop", _ts: 9000 }),
    ]);

    const s = map.get("s1")!;
    expect(s.launched).toBe(true);
    expect(s.eventCount).toBe(3);
    expect(s.idleSince).toBe(9000);
  });
});
