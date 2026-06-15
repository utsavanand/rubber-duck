import { describe, expect, it } from "vitest";
import {
  PersistedSession,
  repoNameFrom,
  sessionKeyOf,
  viewFromPersisted,
} from "./types";

function persisted(over: Partial<PersistedSession> = {}): PersistedSession {
  return {
    session_key: "s1",
    state: "busy",
    event_count: 3,
    started_at: 100,
    updated_at: 200,
    ...over,
  };
}

describe("viewFromPersisted", () => {
  it("prefers the user name for the label, falling back to source_app then a key prefix", () => {
    expect(viewFromPersisted(persisted({ name: "Login refactor" })).label).toBe(
      "Login refactor",
    );
    expect(viewFromPersisted(persisted({ source_app: "myrepo" })).label).toBe(
      "myrepo",
    );
    expect(
      viewFromPersisted(persisted({ session_key: "abcdef123456" })).label,
    ).toBe("abcdef12");
  });

  it("maps the grp column to the group field, leaving ungrouped as undefined", () => {
    expect(viewFromPersisted(persisted({ grp: "payments" })).group).toBe(
      "payments",
    );
    expect(viewFromPersisted(persisted({ grp: null })).group).toBeUndefined();
  });

  it("treats launched=1 or the legacy heartbeat=1 as launched", () => {
    expect(viewFromPersisted(persisted({ launched: 1 })).launched).toBe(true);
    expect(viewFromPersisted(persisted({ heartbeat: 1 })).launched).toBe(true);
    expect(
      viewFromPersisted(persisted({ launched: 0, heartbeat: 0 })).launched,
    ).toBe(false);
  });

  it("backdates idleSince to 0 for an idle row so it reads idle immediately", () => {
    const v = viewFromPersisted(persisted({ state: "idle" }));

    // The server already settled it; don't restart the grace on the client.
    expect(v.state).toBe("busy");
    expect(v.idleSince).toBe(0);
  });
});

describe("repoNameFrom", () => {
  it("returns the repo basename for a normal path", () => {
    expect(repoNameFrom("/Users/a/projects/rubber-duck")).toBe("rubber-duck");
  });

  it("uses source_app for a Rubberduck worktree path (the basename would be the branch)", () => {
    expect(
      repoNameFrom("/Users/a/.rubberduck/worktrees/feature-x", "rubber-duck"),
    ).toBe("rubber-duck");
  });

  it("falls back to source_app when there is no repo path", () => {
    expect(repoNameFrom(null, "myrepo")).toBe("myrepo");
  });
});

describe("sessionKeyOf", () => {
  it("reads the key from any of the accepted fields", () => {
    expect(sessionKeyOf({ session_key: "a", _id: "x", _ts: 1 })).toBe("a");
    expect(sessionKeyOf({ session_id: "b", _id: "x", _ts: 1 })).toBe("b");
    expect(sessionKeyOf({ _id: "x", _ts: 1 })).toBeUndefined();
  });
});
