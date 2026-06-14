import { useEffect, useReducer, useState } from "react";
import { applyEvent } from "./sessions";
import {
  PersistedSession,
  RubberduckEvent,
  sessionKeyOf,
  SessionView,
  viewFromPersisted,
} from "./types";

type InitFrame = { type: "init"; events: RubberduckEvent[] };

type Action =
  | { kind: "seed"; sessions: PersistedSession[] }
  | { kind: "event"; event: RubberduckEvent }
  | { kind: "remove"; keys: string[] };

// The reducer tracks deleted keys so a still-firing watched session (whose hooks
// keep streaming events) can't resurrect a row the user just deleted — mirrors
// the server's tombstone. A fresh SessionStart lifts the tombstone.
interface State {
  sessions: Map<string, SessionView>;
  tombstoned: Set<string>;
}

function isInit(data: unknown): data is InitFrame {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as InitFrame).type === "init"
  );
}

function mergeDefined(base: SessionView, over: SessionView): SessionView {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function reduce(state: State, action: Action): State {
  if (action.kind === "seed") {
    const next = new Map(state.sessions);
    for (const s of action.sessions) {
      const persisted = viewFromPersisted(s);
      const live = next.get(s.session_key);
      // Persisted is the base (it carries identity/metadata a live event can't:
      // repoName, worktreePath, notes, intention). Then layer the live view's
      // DEFINED fields on top so dynamic state (state, eventCount, name) wins
      // without undefined live fields clobbering persisted ones.
      next.set(s.session_key, live ? mergeDefined(persisted, live) : persisted);
    }
    // A seed only lists live sessions; anything we'd tombstoned that the server
    // confirms exists again can drop its tombstone.
    const tombstoned = new Set(state.tombstoned);
    for (const s of action.sessions) tombstoned.delete(s.session_key);
    return { sessions: next, tombstoned };
  }
  if (action.kind === "remove") {
    const next = new Map(state.sessions);
    const tombstoned = new Set(state.tombstoned);
    for (const key of action.keys) {
      next.delete(key);
      tombstoned.add(key);
    }
    return { sessions: next, tombstoned };
  }
  // A live event for a tombstoned (deleted) session must not resurrect it —
  // unless it's a SessionStart, which means the key is genuinely a new session.
  const key = sessionKeyOf(action.event);
  if (key && state.tombstoned.has(key)) {
    if (action.event.event_type !== "SessionStart") return state;
    const tombstoned = new Set(state.tombstoned);
    tombstoned.delete(key);
    return { sessions: applyEvent(state.sessions, action.event), tombstoned };
  }
  return { ...state, sessions: applyEvent(state.sessions, action.event) };
}

export function useEventStream(): {
  sessions: SessionView[];
  connected: boolean;
  recentEvents: RubberduckEvent[];
  removeSessions: (keys: string[]) => void;
} {
  const [state, dispatch] = useReducer(reduce, {
    sessions: new Map<string, SessionView>(),
    tombstoned: new Set<string>(),
  });
  const [connected, setConnected] = useState(false);
  // Rolling buffer of the newest events, newest first, for the Pulse ticker.
  const [recentEvents, setRecentEvents] = useState<RubberduckEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/sessions")
      .then((r) => r.json())
      .then((data: { sessions: PersistedSession[] }) => {
        if (!cancelled) dispatch({ kind: "seed", sessions: data.sessions });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (msg) => {
      const data: unknown = JSON.parse(msg.data);
      if (isInit(data)) {
        data.events.forEach((event) => dispatch({ kind: "event", event }));
        setRecentEvents((prev) =>
          [...data.events].reverse().concat(prev).slice(0, 100),
        );
      } else {
        const event = data as RubberduckEvent;
        dispatch({ kind: "event", event });
        setRecentEvents((prev) => [event, ...prev].slice(0, 100));
      }
    };
    return () => source.close();
  }, []);

  // Stable order: newest session first by START time, which never changes —
  // so cards don't reshuffle (and buttons don't move) as events stream in.
  const list = [...state.sessions.values()].sort(
    (a, b) => b.startedAt - a.startedAt || a.key.localeCompare(b.key),
  );
  const removeSessions = (keys: string[]) => dispatch({ kind: "remove", keys });
  return { sessions: list, connected, recentEvents, removeSessions };
}
