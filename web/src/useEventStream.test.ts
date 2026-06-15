import { describe, expect, it } from "vitest";
import { reduce, State } from "./useEventStream";
import { RubberduckEvent, SessionView } from "./types";

const emptyState = (): State => ({
  sessions: new Map<string, SessionView>(),
  tombstoned: new Set<string>(),
});

function ev(
  e: Partial<RubberduckEvent> & { event_type: string },
): RubberduckEvent {
  return { session_key: "s1", _id: "e", _ts: 1, ...e } as RubberduckEvent;
}

describe("reduce — remove (tombstone)", () => {
  it("removes a session and tombstones its key", () => {
    const seeded = reduce(emptyState(), {
      kind: "event",
      event: ev({ event_type: "SessionStart" }),
    });

    const after = reduce(seeded, { kind: "remove", keys: ["s1"] });

    expect(after.sessions.has("s1")).toBe(false);
    expect(after.tombstoned.has("s1")).toBe(true);
  });

  it("does not resurrect a tombstoned session from a later non-SessionStart event", () => {
    const removed = reduce(emptyState(), { kind: "remove", keys: ["s1"] });

    const after = reduce(removed, {
      kind: "event",
      event: ev({ event_type: "PreToolUse" }),
    });

    expect(after.sessions.has("s1")).toBe(false);
  });

  it("lifts the tombstone for a genuine new SessionStart", () => {
    const removed = reduce(emptyState(), { kind: "remove", keys: ["s1"] });

    const after = reduce(removed, {
      kind: "event",
      event: ev({ event_type: "SessionStart" }),
    });

    expect(after.sessions.has("s1")).toBe(true);
    expect(after.tombstoned.has("s1")).toBe(false);
  });
});

describe("reduce — patch (optimistic update)", () => {
  it("merges fields into an existing session without an event", () => {
    const seeded = reduce(emptyState(), {
      kind: "event",
      event: ev({ event_type: "SessionStart" }),
    });

    const after = reduce(seeded, {
      kind: "patch",
      key: "s1",
      fields: { group: "payments" },
    });

    expect(after.sessions.get("s1")!.group).toBe("payments");
  });

  it("is a no-op for an unknown key", () => {
    const before = emptyState();
    const after = reduce(before, {
      kind: "patch",
      key: "ghost",
      fields: { group: "x" },
    });
    expect(after).toBe(before);
  });
});

describe("reduce — seed", () => {
  it("seeds persisted rows and clears their tombstones", () => {
    const removed = reduce(emptyState(), { kind: "remove", keys: ["s1"] });

    const after = reduce(removed, {
      kind: "seed",
      sessions: [
        {
          session_key: "s1",
          state: "busy",
          event_count: 1,
          started_at: 1,
          updated_at: 1,
        },
      ],
    });

    expect(after.sessions.has("s1")).toBe(true);
    expect(after.tombstoned.has("s1")).toBe(false);
  });
});
